import copy
import errno
import json
import os
import pty
import re
import shlex
import shutil
import signal
import socket
import subprocess
from datetime import datetime
from functools import wraps

import psutil
import requests
from flask import Flask, Response, jsonify, render_template, request, send_file
from werkzeug.middleware.proxy_fix import ProxyFix

from lib.ha import HomeAssistantClient
from lib.hw import (
    detect_digilent_programmers,
    detect_flashpro_programmers,
    detect_programmers,
)
from lib.ku_fw import (
    apply_firmware_set,
    build_firmware_zip,
    current_set_name,
    delete_firmware_set,
    ku_bin_dir,
    list_firmware_details,
    list_firmware_sets,
    persist_hw_configs,
    sanitize_tag,
    save_firmware_set,
    validate_upload_files,
)
from lib.mariadb import (
    check_dna_in_db,
    decode_serial_no,
    get_daughterboard_by_serial,
    lookup_daughterboard_pair,
    register_daughterboard,
    serialize_daughterboard,
    update_daughterboard_test_flag,
    update_daughterboard_fields,
    get_component_lots_by_type,
)


HA_URL = "http://ha.piro-atlas-lab.fysik.su.se:8123"
HA_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI4YjEyZWE1Yzc4NTE0Y2FmODRlNWQzYWQwMmIzZTNjNyIsImlhdCI6MTc3MTIxODg3MCwiZXhwIjoyMDg2NTc4ODcwfQ.7BnKN_KS1Pa5SuKWXXDv2xoZtkSH05ttgAq3OSzCQdk"

ha = HomeAssistantClient(
    base_url=HA_URL,
    token=HA_TOKEN,
    timeout=5,
)

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_prefix=1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BASE_DIR)
RESOURCES_FOLDER = os.path.join(BASE_DIR, "resources")
GIT_FORCE_PHRASE = "force git"
GIT_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")

VIVADO_LOG_FOLDER = os.path.join(RESOURCES_FOLDER, "ku/logs/vivado")
VIVADO_TCL_FOLDER = os.path.join(RESOURCES_FOLDER, "ku/tcl")
FPEXPRESS_LOG_FOLDER = os.path.join(RESOURCES_FOLDER, "proasic/logs/fpexpress")
FPEXPRESS_TCL_FOLDER = os.path.join(RESOURCES_FOLDER, "proasic/tcl")
HW_CONFIG_PATH = os.path.join(RESOURCES_FOLDER, "hw_config.json")

for folder in (
    VIVADO_LOG_FOLDER,
    VIVADO_TCL_FOLDER,
    FPEXPRESS_LOG_FOLDER,
    FPEXPRESS_TCL_FOLDER,
):
    os.makedirs(folder, exist_ok=True)

VIVADO_SETTINGS = "/tools/Xilinx/Vivado_Lab/2022.2/settings64.sh"
VIVADO_LAB_BIN = "/tools/Xilinx/Vivado_Lab/2022.2/bin/vivado_lab"
FLASH_PRO_CMD = "/microsemi/Libero_SoC_11.10/Libero_SoC/Designer/bin/FPExpress"


def _empty_hw_config():
    """Minimal host config used when this machine is not yet registered."""
    return {
        "ha_power_control": {"sides": {"a": "", "b": ""}},
        "ku": {
            "jtag_freq_hz": 15_000_000,
            "sides": {
                "a": {
                    "serial": "",
                    "hw_server": "localhost:3121",
                    "target": "xilinx_tcf/Digilent/",
                    "device": "xcku035",
                    "bitfile": "",
                    "binfile": "",
                    "ltxfile": "",
                },
                "b": {
                    "serial": "",
                    "hw_server": "localhost:3121",
                    "target": "xilinx_tcf/Digilent/",
                    "device": "xcku035",
                    "bitfile": "",
                    "binfile": "",
                    "ltxfile": "",
                },
            },
        },
        "proasic": {
            "sides": {
                "a": {"programmer": ""},
                "b": {"programmer": ""},
            }
        },
    }


with open(HW_CONFIG_PATH, "r") as f:
    ALL_HW_CONFIGS = json.load(f)

HOSTNAME = socket.gethostname()
HOST_REGISTERED = HOSTNAME in ALL_HW_CONFIGS
HW_CONFIG = ALL_HW_CONFIGS.get(HOSTNAME) or _empty_hw_config()

KU_SERIAL_TO_SIDE = {
    v["serial"]: side.upper()
    for side, v in HW_CONFIG.get("ku", {}).get("sides", {}).items()
    if (v or {}).get("serial")
}
PROASIC_PROG_TO_SIDE = {
    v["programmer"]: side.upper()
    for side, v in HW_CONFIG.get("proasic", {}).get("sides", {}).items()
    if (v or {}).get("programmer")
}
ha_cfg = HW_CONFIG.get("ha_power_control", {}).get("sides", {})
if not isinstance(ha_cfg, dict):
    ha_cfg = {}

SIDE_TO_HA_ENTITY = {
    side.upper(): entity for side, entity in ha_cfg.items() if entity
}

_KU_SERIALS = "|".join(map(re.escape, KU_SERIAL_TO_SIDE)) or "___NO_SERIAL___"
KU_RESULT_PATTERN = re.compile(
    rf"\(({_KU_SERIALS})\) Tile Operation (Success|Failure)!"
)
KU_DNA_PATTERN = re.compile(
    rf"\(({_KU_SERIALS})\).*FUSE_DNA\s*=\s*([0-9A-F]+)",
    re.I,
)

# Digilent / Vivado Lab commonly accepted JTAG TCK steps (Hz).
KU_JTAG_FREQ_CHOICES = (
    5_000_000,
    6_000_000,
    10_000_000,
    15_000_000,
    20_000_000,
    25_000_000,
    30_000_000,
    40_000_000,
    60_000_000,
)


def _parse_bool_arg(value, default=True):
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _ku_serial_to_side(cable_a=None, cable_b=None, enable_a=True, enable_b=True):
    """Build serial→side map using config defaults plus optional session overrides."""
    mapping = {}
    enabled = {"a": enable_a, "b": enable_b}
    for side, info in HW_CONFIG.get("ku", {}).get("sides", {}).items():
        if not enabled.get(side, True):
            continue
        serial = (info or {}).get("serial")
        if side == "a" and cable_a:
            serial = cable_a
        elif side == "b" and cable_b:
            serial = cable_b
        if serial:
            mapping[serial] = side.upper()
    return mapping


def _ku_line_patterns(serial_to_side):
    serials = "|".join(map(re.escape, serial_to_side)) or "___NO_SERIAL___"
    return (
        re.compile(rf"\(({serials})\) Tile Operation (Success|Failure)!"),
        re.compile(rf"\(({serials})\).*FUSE_DNA\s*=\s*([0-9A-F]+)", re.I),
    )


def _parse_cable_serial_from_target(target_path):
    text = (target_path or "").strip()
    if not text:
        return None
    # localhost:3121/xilinx_tcf/Digilent/<serial>
    parts = text.split("/")
    if not parts:
        return None
    serial = parts[-1].strip()
    return serial or None


def _list_ku_cables_via_vivado(timeout_s=45):
    """Open a short Vivado Lab session and list Digilent hw_targets."""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_list_cables.log")
    jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_list_cables.jou")
    tcl = os.path.join(VIVADO_TCL_FOLDER, "list_ku_cables.tcl")

    hw_server = None
    try:
        hw_server = HW_CONFIG["ku"]["sides"]["a"]["hw_server"]
    except (KeyError, TypeError):
        hw_server = "localhost:3121"

    command = (
        f"bash -c 'source {shlex.quote(VIVADO_SETTINGS)} && "
        f"export KU_HW_SERVER_URL={shlex.quote(hw_server)} && "
        f"vivado_lab -mode batch -log {shlex.quote(log_file)} "
        f"-journal {shlex.quote(jou_file)} -source {shlex.quote(tcl)}'"
    )

    try:
        completed = subprocess.run(
            command,
            shell=True,
            text=True,
            capture_output=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return None, f"Vivado cable listing timed out after {timeout_s}s"

    output = "\n".join(
        part for part in (completed.stdout or "", completed.stderr or "") if part
    )
    if completed.returncode != 0 and "CABLE_TARGET:" not in output:
        # Fall back to log file if PTY-less batch dumped there only.
        try:
            with open(log_file, "r", errors="replace") as handle:
                output = handle.read()
        except OSError:
            pass

    cables = []
    freq_by_target = {}
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("CABLE_FREQ:"):
            rest = line[len("CABLE_FREQ:"):].strip()
            parts = rest.rsplit(" ", 1)
            if len(parts) == 2:
                freq_by_target[parts[0]] = parts[1]
            continue
        if not line.startswith("CABLE_TARGET:"):
            continue
        target = line[len("CABLE_TARGET:"):].strip()
        serial = _parse_cable_serial_from_target(target)
        if not serial:
            continue
        cables.append({
            "serial": serial,
            "target": target,
            "frequency_hz": freq_by_target.get(target),
        })

    # Attach freqs that arrived after targets in the log.
    for cable in cables:
        if cable["frequency_hz"] is None and cable["target"] in freq_by_target:
            cable["frequency_hz"] = freq_by_target[cable["target"]]

    if not cables and completed.returncode != 0:
        return None, (
            f"Vivado cable listing failed (exit {completed.returncode}). "
            f"See {log_file}"
        )

    return cables, None
_PROASIC_PROGRAMMERS = "|".join(map(re.escape, PROASIC_PROG_TO_SIDE))
PROASIC_RESULT_PATTERN = re.compile(
    r"programmer\s+'([^']+)'.*?\s(PASSED|FAILED)",
    re.I,
)
PROASIC_FSN_PATTERN = re.compile(
    r"programmer\s+'([^']+)'.*?EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)",
    re.I,
)


def _proasic_side_from_programmer(programmer):
    text = (programmer or "").upper()
    for name, side in PROASIC_PROG_TO_SIDE.items():
        token = name.upper()
        if token and (token in text or text in token):
            return side
    return None

KU_ACTIONS = {
    "get_ku_properties": "get_ku_properties.tcl",
    "program_ku": "program_ku.tcl",
    "program_ku_flash": "program_ku_flash.tcl",
    "verify_ku_flash": "verify_ku_flash.tcl",
    "erase_ku_flash": "erase_ku_flash.tcl",
    "blank_check_ku_flash": "blank_check_ku_flash.tcl",
}

PROASIC_ACTIONS = {
    "get_proasic_info": "device_info.tcl",
    "verify_proasic": "verify_device.tcl",
    "program_proasic": "program_device.tcl",
}

_PROCESS_NAMES_TO_KILL = frozenset({"vivado_lab", "cs_server", "FPExpress_bin"})
_SERVICE_RESTART_ALLOWLIST = frozenset({"tile-wjtag", "hwserver-aux"})


def _count_named_processes():
    counts = {name: 0 for name in sorted(_PROCESS_NAMES_TO_KILL)}
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            name = proc.info["name"]
            if name in counts:
                counts[name] += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return counts


def _kill_named_processes(names):
    wanted = set(names) & _PROCESS_NAMES_TO_KILL
    killed = []
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            name = proc.info["name"]
            if name in wanted:
                os.kill(proc.info["pid"], signal.SIGTERM)
                killed.append({"name": name, "pid": proc.info["pid"]})
        except Exception as e:
            print(f"Error killing process {proc.info.get('name')}: {e}")
    return killed


def _restart_local_service(service_name):
    if service_name not in _SERVICE_RESTART_ALLOWLIST:
        raise ValueError(f"service not allowed: {service_name}")
    response = requests.post(
        "http://127.0.0.1:8081/action",
        data={
            "service": service_name,
            "action": "restart",
        },
        timeout=5,
    )
    response.raise_for_status()
    return "restarted"

# Prime CPU counter so later reads are non-blocking.
psutil.cpu_percent()

print(f"Loaded hardware config for {HOSTNAME}")


# ===============================
# PROCESS EXECUTION
# ===============================

def run_process(command, source_type, ku_serial_to_side=None):
    """
    Executes a process via PTY and streams output for Flask SSE.
    Handles ProASIC and Xilinx KU separately for accurate per-side status.
    """
    master_fd, slave_fd = pty.openpty()

    process = subprocess.Popen(
        command,
        stdout=slave_fd,
        stderr=slave_fd,
        shell=True,
        text=True,
        close_fds=True,
    )

    os.close(slave_fd)

    if source_type == "proasic":
        yield from _run_process_proasic(process, master_fd)
    elif source_type == "ku":
        yield from _run_process_ku(
            process,
            master_fd,
            ku_serial_to_side or KU_SERIAL_TO_SIDE,
        )
    else:
        yield from _run_process_generic(process, master_fd)


def _read_pty_lines(process, master_fd):
    """Read PTY output line-by-line, tolerating EIO on hangup."""
    try:
        with os.fdopen(master_fd) as stdout:
            for line in stdout:
                yield line
    except OSError as e:
        if e.errno != errno.EIO:
            raise
    finally:
        process.wait()


def _run_process_proasic(process, master_fd):
    side_status = {}

    for line in _read_pty_lines(process, master_fd):
        yield {"source": "proasic", "line": line}

        fsn_match = PROASIC_FSN_PATTERN.search(line)
        if fsn_match:
            side = _proasic_side_from_programmer(fsn_match.group(1))
            if side and side_status.get(side) != "failure":
                side_status[side] = "success"

        match = PROASIC_RESULT_PATTERN.search(line)
        if not match:
            continue

        programmer = match.group(1)
        result = match.group(2).upper()
        side = _proasic_side_from_programmer(programmer)
        if side:
            side_status[side] = "success" if result == "PASSED" else "failure"

    both_ok = side_status.get("A") == "success" and side_status.get("B") == "success"
    status = "success" if both_ok else "failure"
    yield {"source": "proasic", "status": status, "side_status": side_status}


def _maybe_yield_daughterboard_match(registered_sides):
    """Emit full daughterboard data when both KU sides match the same DB serial."""
    if "A" not in registered_sides or "B" not in registered_sides:
        return None

    side_a = registered_sides["A"]
    side_b = registered_sides["B"]

    if side_a["serial_no"] != side_b["serial_no"]:
        return {
            "source": "ku",
            "daughterboard_status": "mismatch_serial",
            "line": (
                f"ERROR: Side A and B DNAs belong to different daughterboards "
                f"({side_a['serial_no']} vs {side_b['serial_no']})."
            ),
            "side_a": side_a,
            "side_b": side_b,
        }

    row = get_daughterboard_by_serial(side_a["serial_no"])
    if not row:
        return {
            "source": "ku",
            "daughterboard_status": "not_found",
            "line": f"ERROR: Daughterboard {side_a['serial_no']} not found in DB.",
        }

    daughterboard = serialize_daughterboard(row)
    decoded = decode_serial_no(daughterboard["serial_no"]) or {}
    batch_no = decoded.get("batch_no", daughterboard.get("batch_id"))
    return {
        "source": "ku",
        "daughterboard_status": "matched",
        "line": (
            f"Daughterboard pair matched: serial {daughterboard['serial_no']}, "
            f"batch {batch_no}."
        ),
        "daughterboard": daughterboard,
    }


def _run_process_ku(process, master_fd, serial_to_side=None):
    side_status = {}
    dna_cache = {}
    registered_sides = {}
    daughterboard_announced = False
    serial_to_side = serial_to_side or KU_SERIAL_TO_SIDE
    result_pattern, dna_pattern = _ku_line_patterns(serial_to_side)

    for line in _read_pty_lines(process, master_fd):
        yield {"source": "ku", "line": line.strip()}

        dna_match = dna_pattern.search(line)
        if dna_match:
            serial = dna_match.group(1)
            dna = dna_match.group(2)

            yield {"source": "ku", "line": f"Found DNA for {serial}: {dna}"}

            if dna not in dna_cache:
                dna_cache[dna] = check_dna_in_db(dna)
            db_info = dna_cache[dna]
            expected_side = serial_to_side.get(serial)

            if db_info:
                db_side = db_info["side"]

                if db_side != expected_side:
                    yield {
                        "source": "ku",
                        "line": (
                            f"ERROR: DNA {dna} belongs to DB side {db_side} "
                            f"but is connected to physical side {expected_side}"
                        ),
                        "db_status": "side_mismatch",
                        "serial_no": db_info["serial_no"],
                        "batch_id": db_info["batch_id"],
                        "side": db_side,
                        "expected_side": expected_side,
                    }
                else:
                    registered_sides[db_side] = {
                        "dna": dna,
                        "serial_no": db_info["serial_no"],
                        "batch_id": db_info["batch_id"],
                        "side": db_side,
                    }
                    decoded = decode_serial_no(db_info["serial_no"]) or {}
                    batch_label = decoded.get("batch_no", db_info["batch_id"])
                    yield {
                        "source": "ku",
                        "line": (
                            f"DNA {dna} correctly registered for side {db_side}, "
                            f"Serial: {db_info['serial_no']}, Batch: {batch_label}"
                        ),
                        "db_status": "registered",
                        "serial_no": db_info["serial_no"],
                        "batch_no": batch_label,
                        "side": db_side,
                    }

                    if not daughterboard_announced:
                        match_event = _maybe_yield_daughterboard_match(registered_sides)
                        if match_event:
                            daughterboard_announced = True
                            yield match_event
            else:
                yield {
                    "source": "ku",
                    "line": f"DNA {dna} is NOT registered in DB",
                    "db_status": "unregistered",
                    "dna": dna,
                }

        result_match = result_pattern.search(line)
        if result_match:
            serial = result_match.group(1)
            result = result_match.group(2)
            side = serial_to_side.get(serial)
            if side:
                side_status[side] = "success" if result == "Success" else "failure"

    status = "failure" if "failure" in side_status.values() else "success"
    yield {"source": "ku", "status": status, "side_status": side_status}


def _run_process_generic(process, master_fd):
    for line in _read_pty_lines(process, master_fd):
        yield {"source": "generic", "line": line}

    yield {
        "source": "generic",
        "status": "success" if process.returncode == 0 else "failure",
    }


# ===============================
# COMMAND ROUTING
# ===============================

def _build_vivado_command(
    action,
    timestamp,
    cable_a=None,
    cable_b=None,
    enable_a=True,
    enable_b=True,
):
    log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
    jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")
    tcl = os.path.join(VIVADO_TCL_FOLDER, KU_ACTIONS[action])

    exports = []
    if cable_a:
        exports.append(f"export KU_CABLE_OVERRIDE_A={shlex.quote(cable_a)}")
    if cable_b:
        exports.append(f"export KU_CABLE_OVERRIDE_B={shlex.quote(cable_b)}")
    exports.append(f"export KU_CABLE_ENABLE_A={'1' if enable_a else '0'}")
    exports.append(f"export KU_CABLE_ENABLE_B={'1' if enable_b else '0'}")
    export_prefix = (" && ".join(exports) + " && ") if exports else ""

    return (
        f"bash -c 'source {shlex.quote(VIVADO_SETTINGS)} && "
        f"{export_prefix}"
        f"vivado_lab -mode batch -log {shlex.quote(log_file)} "
        f"-journal {shlex.quote(jou_file)} -source {shlex.quote(tcl)}'"
    )


def _build_fpexpress_command(action, timestamp, tcl_name):
    tcl = os.path.join(FPEXPRESS_TCL_FOLDER, tcl_name)
    log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")
    return (
        f'xvfb-run -a {FLASH_PRO_CMD} '
        f'script:"{tcl}" '
        f'console_mode:show '
        f'logfile:"{log_file}"'
    )


def build_command(
    action,
    cable_a=None,
    cable_b=None,
    enable_a=True,
    enable_b=True,
):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    if action in KU_ACTIONS:
        if action == "get_ku_properties":
            log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
            print(f"Log file: {log_file}")
        return (
            _build_vivado_command(
                action,
                timestamp,
                cable_a,
                cable_b,
                enable_a=enable_a,
                enable_b=enable_b,
            ),
            "ku",
        )

    if action in PROASIC_ACTIONS:
        return _build_fpexpress_command(action, timestamp, PROASIC_ACTIONS[action]), "proasic"

    return None, None


# ===============================
# STREAM ENDPOINT
# ===============================

@app.route("/run/<action>")
def run_action(action):
    if not HOST_REGISTERED:
        return (
            f"Host '{HOSTNAME}' is not registered in hw_config.json. "
            "Register it via Advanced options before running operations.",
            403,
        )

    tools = _detect_tools()
    if action in KU_ACTIONS and not tools["vivado"]["available"]:
        return (
            "Vivado Lab is not available on this host "
            f"(settings={VIVADO_SETTINGS}, binary={tools['vivado']['binary']}).",
            503,
        )
    if action in PROASIC_ACTIONS and not tools["fpexpress"]["available"]:
        return (
            "FPExpress is not available on this host "
            f"(path={tools['fpexpress']['path']}).",
            503,
        )

    cable_a = (request.args.get("cable_a") or "").strip() or None
    cable_b = (request.args.get("cable_b") or "").strip() or None
    enable_a = _parse_bool_arg(request.args.get("enable_a"), True)
    enable_b = _parse_bool_arg(request.args.get("enable_b"), True)

    if action in PROASIC_ACTIONS and (cable_a or cable_b or "enable_a" in request.args or "enable_b" in request.args):
        return "Cable overrides are only valid for KU actions", 400

    if action in KU_ACTIONS and not enable_a and not enable_b:
        return "At least one KU cable must be enabled", 400

    command, source_type = build_command(
        action,
        cable_a=cable_a,
        cable_b=cable_b,
        enable_a=enable_a,
        enable_b=enable_b,
    )

    if not command:
        return "Invalid action", 400

    ku_map = (
        _ku_serial_to_side(cable_a, cable_b, enable_a=enable_a, enable_b=enable_b)
        if source_type == "ku"
        else None
    )

    def event_stream():
        for output in run_process(command, source_type, ku_serial_to_side=ku_map):
            yield f"data: {json.dumps(output)}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/api/get_hostname", methods=["GET"])
def get_hostname():
    try:
        return jsonify({
            "hostname": HOSTNAME,
            "host_registered": HOST_REGISTERED,
            "tools": _detect_tools(),
        })
    except Exception:
        return jsonify({"hostname": "Unknown Server"}), 500


def _detect_tools():
    """Report whether Vivado Lab / FPExpress are present on this host."""
    vivado_settings_ok = os.path.isfile(VIVADO_SETTINGS)
    vivado_bin = VIVADO_LAB_BIN if os.path.isfile(VIVADO_LAB_BIN) else (
        shutil.which("vivado_lab") or ""
    )
    vivado_bin_ok = bool(vivado_bin) and os.path.isfile(vivado_bin)
    fpexpress_path = FLASH_PRO_CMD if os.path.isfile(FLASH_PRO_CMD) else (
        shutil.which("FPExpress") or shutil.which("FPExpress_bin") or ""
    )
    fpexpress_ok = bool(fpexpress_path) and os.access(fpexpress_path, os.X_OK)

    return {
        "vivado": {
            "available": vivado_settings_ok and vivado_bin_ok,
            "settings": VIVADO_SETTINGS,
            "settings_ok": vivado_settings_ok,
            "binary": vivado_bin or VIVADO_LAB_BIN,
            "binary_ok": vivado_bin_ok,
        },
        "fpexpress": {
            "available": fpexpress_ok,
            "path": fpexpress_path or FLASH_PRO_CMD,
            "path_ok": fpexpress_ok,
        },
    }


def _host_status_payload():
    return {
        "hostname": HOSTNAME,
        "host_registered": HOST_REGISTERED,
        "hw_config_path": HW_CONFIG_PATH,
        "known_hosts": sorted(ALL_HW_CONFIGS.keys()),
        "tools": _detect_tools(),
    }


def _require_host_registered(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not HOST_REGISTERED:
            return jsonify({
                "error": (
                    f"Host '{HOSTNAME}' is not registered in hw_config.json. "
                    "Open Advanced options (Global unlock) to register it."
                ),
                "host_registered": False,
                "hostname": HOSTNAME,
            }), 403
        return view(*args, **kwargs)

    return wrapped


def _default_firmware_paths():
    """Pick a complete firmware set from resources/ku/bin if available."""
    bin_dir = ku_bin_dir(RESOURCES_FOLDER)
    details = list_firmware_details(bin_dir)
    for name in list_firmware_sets(bin_dir):
        meta = details.get(name) or {}
        if meta.get("complete"):
            return {
                "bitfile": os.path.join(bin_dir, f"{name}.bit"),
                "binfile": os.path.join(bin_dir, f"{name}.bin"),
                "ltxfile": os.path.join(bin_dir, f"{name}.ltx"),
            }
    # Fall back to any .bin
    for name in list_firmware_sets(bin_dir):
        return {
            "bitfile": os.path.join(bin_dir, f"{name}.bit") if os.path.isfile(os.path.join(bin_dir, f"{name}.bit")) else "",
            "binfile": os.path.join(bin_dir, f"{name}.bin") if os.path.isfile(os.path.join(bin_dir, f"{name}.bin")) else "",
            "ltxfile": os.path.join(bin_dir, f"{name}.ltx") if os.path.isfile(os.path.join(bin_dir, f"{name}.ltx")) else "",
        }
    return {"bitfile": "", "binfile": "", "ltxfile": ""}


def _build_host_config_from_clone(clone_from=None):
    if clone_from and clone_from in ALL_HW_CONFIGS:
        cfg = copy.deepcopy(ALL_HW_CONFIGS[clone_from])
    else:
        cfg = _empty_hw_config()
        paths = _default_firmware_paths()
        for side in ("a", "b"):
            cfg["ku"]["sides"][side].update(paths)
    return cfg


def _validate_host_config(cfg):
    if not isinstance(cfg, dict):
        return "host config must be an object"
    if "ku" not in cfg or "proasic" not in cfg:
        return "host config must include ku and proasic"
    ku_sides = (cfg.get("ku") or {}).get("sides")
    if not isinstance(ku_sides, dict) or "a" not in ku_sides or "b" not in ku_sides:
        return "ku.sides must include a and b"
    pro_sides = (cfg.get("proasic") or {}).get("sides")
    if not isinstance(pro_sides, dict) or "a" not in pro_sides or "b" not in pro_sides:
        return "proasic.sides must include a and b"
    return None


def _apply_host_field_updates(cfg, fields):
    """Apply structured field updates onto a host config dict."""
    cfg = copy.deepcopy(cfg)
    if not isinstance(fields, dict):
        return cfg

    ku = cfg.setdefault("ku", {})
    ku_sides = ku.setdefault("sides", {})
    for side in ("a", "b"):
        side_cfg = ku_sides.setdefault(side, {})
        serial_key = f"ku_serial_{side}"
        if serial_key in fields:
            side_cfg["serial"] = str(fields.get(serial_key) or "").strip()
        for key in ("hw_server", "target", "device", "bitfile", "binfile", "ltxfile"):
            field_key = f"ku_{key}_{side}"
            if field_key in fields:
                side_cfg[key] = str(fields.get(field_key) or "").strip()

    if "jtag_freq_hz" in fields:
        try:
            freq = int(fields.get("jtag_freq_hz"))
            if freq in KU_JTAG_FREQ_CHOICES:
                ku["jtag_freq_hz"] = freq
        except (TypeError, ValueError):
            pass

    pro = cfg.setdefault("proasic", {}).setdefault("sides", {})
    for side in ("a", "b"):
        side_cfg = pro.setdefault(side, {})
        key = f"proasic_programmer_{side}"
        if key in fields:
            side_cfg["programmer"] = str(fields.get(key) or "").strip()

    ha = cfg.setdefault("ha_power_control", {}).setdefault("sides", {})
    for side in ("a", "b"):
        key = f"ha_entity_{side}"
        if key in fields:
            ha[side] = str(fields.get(key) or "").strip()

    return cfg


def _host_fields_from_config(cfg):
    ku = (cfg or {}).get("ku") or {}
    sides = ku.get("sides") or {}
    pro = ((cfg or {}).get("proasic") or {}).get("sides") or {}
    ha = ((cfg or {}).get("ha_power_control") or {}).get("sides") or {}
    a = sides.get("a") or {}
    b = sides.get("b") or {}
    return {
        "jtag_freq_hz": ku.get("jtag_freq_hz") or 15_000_000,
        "ku_serial_a": a.get("serial") or "",
        "ku_serial_b": b.get("serial") or "",
        "ku_hw_server_a": a.get("hw_server") or "localhost:3121",
        "ku_hw_server_b": b.get("hw_server") or "localhost:3121",
        "ku_target_a": a.get("target") or "xilinx_tcf/Digilent/",
        "ku_target_b": b.get("target") or "xilinx_tcf/Digilent/",
        "ku_device_a": a.get("device") or "xcku035",
        "ku_device_b": b.get("device") or "xcku035",
        "ku_bitfile_a": a.get("bitfile") or "",
        "ku_bitfile_b": b.get("bitfile") or "",
        "ku_binfile_a": a.get("binfile") or "",
        "ku_binfile_b": b.get("binfile") or "",
        "ku_ltxfile_a": a.get("ltxfile") or "",
        "ku_ltxfile_b": b.get("ltxfile") or "",
        "proasic_programmer_a": (pro.get("a") or {}).get("programmer") or "",
        "proasic_programmer_b": (pro.get("b") or {}).get("programmer") or "",
        "ha_entity_a": ha.get("a") or "",
        "ha_entity_b": ha.get("b") or "",
    }


@app.route("/api/hw_config", methods=["GET"])
def get_hw_config():
    payload = dict(HW_CONFIG) if isinstance(HW_CONFIG, dict) else {}
    # Clients that expect a bare config still work; extras are additive.
    return jsonify({
        **payload,
        "host_registered": HOST_REGISTERED,
        "hostname": HOSTNAME,
        "tools": _detect_tools(),
    })


@app.route("/api/bootstrap", methods=["GET"])
def api_bootstrap():
    """Single payload for UI gates: host registration + tools + config."""
    return jsonify({
        **_host_status_payload(),
        "hw_config": HW_CONFIG if HOST_REGISTERED else None,
        "host_fields": _host_fields_from_config(HW_CONFIG) if HOST_REGISTERED else _host_fields_from_config(_empty_hw_config()),
    })


def _reload_runtime_hw_globals():
    """Refresh in-memory maps after hw_config.json is rewritten."""
    global HW_CONFIG, HOST_REGISTERED, KU_SERIAL_TO_SIDE, PROASIC_PROG_TO_SIDE
    global SIDE_TO_HA_ENTITY, KU_RESULT_PATTERN, KU_DNA_PATTERN, _KU_SERIALS

    HOST_REGISTERED = HOSTNAME in ALL_HW_CONFIGS
    HW_CONFIG = ALL_HW_CONFIGS.get(HOSTNAME) or _empty_hw_config()

    KU_SERIAL_TO_SIDE = {
        v["serial"]: side.upper()
        for side, v in HW_CONFIG.get("ku", {}).get("sides", {}).items()
        if (v or {}).get("serial")
    }
    PROASIC_PROG_TO_SIDE = {
        v["programmer"]: side.upper()
        for side, v in HW_CONFIG.get("proasic", {}).get("sides", {}).items()
        if (v or {}).get("programmer")
    }
    ha_cfg_local = HW_CONFIG.get("ha_power_control", {}).get("sides", {})
    if not isinstance(ha_cfg_local, dict):
        ha_cfg_local = {}
    SIDE_TO_HA_ENTITY = {
        side.upper(): entity for side, entity in ha_cfg_local.items() if entity
    }

    _KU_SERIALS = "|".join(map(re.escape, KU_SERIAL_TO_SIDE)) or "___NO_SERIAL___"
    KU_RESULT_PATTERN = re.compile(
        rf"\(({_KU_SERIALS})\) Tile Operation (Success|Failure)!"
    )
    KU_DNA_PATTERN = re.compile(
        rf"\(({_KU_SERIALS})\).*FUSE_DNA\s*=\s*([0-9A-F]+)",
        re.I,
    )


@app.route("/api/hw_config/file", methods=["GET"])
def api_get_hw_config_file():
    return jsonify({
        "path": HW_CONFIG_PATH,
        "hostname": HOSTNAME,
        "config": ALL_HW_CONFIGS,
    })


@app.route("/api/hw_config/file", methods=["PUT"])
def api_put_hw_config_file():
    payload = request.get_json(silent=True) or {}
    config = payload.get("config")
    if not isinstance(config, dict) or not config:
        return jsonify({"error": "config object is required"}), 400
    if HOSTNAME not in config:
        return jsonify({
            "error": f"config must include an entry for this host ({HOSTNAME})",
        }), 400
    if not isinstance(config.get(HOSTNAME), dict):
        return jsonify({"error": f"invalid host config for {HOSTNAME}"}), 400
    err = _validate_host_config(config[HOSTNAME])
    if err:
        return jsonify({"error": err}), 400

    ALL_HW_CONFIGS.clear()
    ALL_HW_CONFIGS.update(config)
    try:
        persist_hw_configs(HW_CONFIG_PATH, ALL_HW_CONFIGS)
        _reload_runtime_hw_globals()
    except Exception as exc:
        return jsonify({"error": f"failed to save hw_config: {exc}"}), 500

    return jsonify({
        "status": "ok",
        "path": HW_CONFIG_PATH,
        "hostname": HOSTNAME,
        "host_registered": HOST_REGISTERED,
        "config": ALL_HW_CONFIGS,
        "hw_config": HW_CONFIG,
        "tools": _detect_tools(),
    })


@app.route("/api/host/register", methods=["POST"])
def api_register_host():
    """Create (or replace) this machine's entry in hw_config.json."""
    payload = request.get_json(silent=True) or {}
    clone_from = (payload.get("clone_from") or "").strip() or None
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    force = bool(payload.get("force"))

    if HOST_REGISTERED and not force:
        return jsonify({
            "error": f"Host '{HOSTNAME}' is already registered. Pass force=true to replace.",
            "host_registered": True,
            "hostname": HOSTNAME,
        }), 409

    if clone_from and clone_from not in ALL_HW_CONFIGS:
        return jsonify({
            "error": f"Unknown clone source host: {clone_from}",
            "known_hosts": sorted(ALL_HW_CONFIGS.keys()),
        }), 400

    cfg = _build_host_config_from_clone(clone_from)
    cfg = _apply_host_field_updates(cfg, fields)
    err = _validate_host_config(cfg)
    if err:
        return jsonify({"error": err}), 400

    ALL_HW_CONFIGS[HOSTNAME] = cfg
    try:
        persist_hw_configs(HW_CONFIG_PATH, ALL_HW_CONFIGS)
        _reload_runtime_hw_globals()
    except Exception as exc:
        return jsonify({"error": f"failed to save hw_config: {exc}"}), 500

    return jsonify({
        "status": "ok",
        "message": f"Host '{HOSTNAME}' registered",
        "hostname": HOSTNAME,
        "host_registered": HOST_REGISTERED,
        "hw_config": HW_CONFIG,
        "host_fields": _host_fields_from_config(HW_CONFIG),
        "tools": _detect_tools(),
        "known_hosts": sorted(ALL_HW_CONFIGS.keys()),
    })


@app.route("/api/host/config", methods=["PUT"])
@_require_host_registered
def api_update_host_config():
    """Structured update of this host's hw_config entry (advanced options)."""
    payload = request.get_json(silent=True) or {}
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else payload
    cfg = _apply_host_field_updates(HW_CONFIG, fields)
    err = _validate_host_config(cfg)
    if err:
        return jsonify({"error": err}), 400

    ALL_HW_CONFIGS[HOSTNAME] = cfg
    try:
        persist_hw_configs(HW_CONFIG_PATH, ALL_HW_CONFIGS)
        _reload_runtime_hw_globals()
    except Exception as exc:
        return jsonify({"error": f"failed to save hw_config: {exc}"}), 500

    return jsonify({
        "status": "ok",
        "hostname": HOSTNAME,
        "host_registered": HOST_REGISTERED,
        "hw_config": HW_CONFIG,
        "host_fields": _host_fields_from_config(HW_CONFIG),
        "tools": _detect_tools(),
    })


@app.route("/api/tools", methods=["GET"])
def api_tools():
    return jsonify(_host_status_payload())


@app.route("/api/ku/advanced", methods=["GET"])
def api_ku_advanced():
    sides = HW_CONFIG.get("ku", {}).get("sides", {})
    return jsonify({
        "jtag_freq_hz": HW_CONFIG.get("ku", {}).get("jtag_freq_hz") or 15_000_000,
        "jtag_freq_choices": list(KU_JTAG_FREQ_CHOICES),
        "default_cables": {
            "a": (sides.get("a") or {}).get("serial"),
            "b": (sides.get("b") or {}).get("serial"),
        },
        "hw_config_path": HW_CONFIG_PATH,
        "hostname": HOSTNAME,
        "host_registered": HOST_REGISTERED,
        "known_hosts": sorted(ALL_HW_CONFIGS.keys()),
        "host_fields": _host_fields_from_config(HW_CONFIG),
        "tools": _detect_tools(),
        "hw_config": HW_CONFIG if HOST_REGISTERED else None,
    })


def _git_run(args, timeout=60):
    """Run a git command in the repo root. Returns (ok, stdout, stderr, returncode)."""
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        stderr = (exc.stderr or "") if isinstance(exc.stderr, str) else "git command timed out"
        return False, stdout.strip(), stderr.strip() or "git command timed out", -1
    except Exception as exc:
        return False, "", str(exc), -1

    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()
    return completed.returncode == 0, stdout, stderr, completed.returncode


def _git_status_payload():
    ok_head, head, err_head, _ = _git_run(["rev-parse", "HEAD"])
    ok_short, short, _, _ = _git_run(["rev-parse", "--short", "HEAD"])
    ok_branch, branch, _, _ = _git_run(["rev-parse", "--abbrev-ref", "HEAD"])
    ok_upstream, upstream, _, _ = _git_run(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]
    )
    ok_dirty, dirty_out, _, _ = _git_run(["status", "--porcelain"])
    dirty_files = [line for line in dirty_out.splitlines() if line.strip()] if ok_dirty else []

    ahead = 0
    behind = 0
    if ok_upstream and upstream:
        ok_counts, counts, _, _ = _git_run(
            ["rev-list", "--left-right", "--count", f"HEAD...{upstream}"]
        )
        if ok_counts and counts:
            parts = counts.split()
            if len(parts) >= 2:
                try:
                    ahead = int(parts[0])
                    behind = int(parts[1])
                except ValueError:
                    ahead = 0
                    behind = 0

    ok_msg, subject, _, _ = _git_run(["log", "-1", "--pretty=%s"])
    ok_remote, remote_url, _, _ = _git_run(["remote", "get-url", "origin"])

    return {
        "repo_root": REPO_ROOT,
        "head": head if ok_head else None,
        "head_short": short if ok_short else None,
        "branch": branch if ok_branch else None,
        "upstream": upstream if ok_upstream else None,
        "ahead": ahead,
        "behind": behind,
        "dirty": bool(dirty_files),
        "dirty_count": len(dirty_files),
        "dirty_files": dirty_files[:40],
        "subject": subject if ok_msg else "",
        "remote": remote_url if ok_remote else None,
        "error": None if ok_head else (err_head or "not a git repository"),
    }


@app.route("/api/git/status", methods=["GET"])
def api_git_status():
    payload = _git_status_payload()
    if payload.get("error"):
        return jsonify(payload), 500
    return jsonify(payload)


@app.route("/api/git/commits", methods=["GET"])
def api_git_commits():
    try:
        limit = int(request.args.get("limit", 40))
    except (TypeError, ValueError):
        limit = 40
    limit = max(1, min(limit, 100))
    do_fetch = request.args.get("fetch", "1") not in ("0", "false", "False")

    fetch_error = None
    if do_fetch:
        ok_fetch, _, err_fetch, _ = _git_run(["fetch", "--prune", "origin"], timeout=120)
        if not ok_fetch:
            fetch_error = err_fetch or "git fetch failed"

    # Prefer origin/<current-branch>, then origin/main, then HEAD.
    ref_candidates = []
    ok_branch, branch, _, _ = _git_run(["rev-parse", "--abbrev-ref", "HEAD"])
    if ok_branch and branch and branch != "HEAD":
        ref_candidates.append(f"origin/{branch}")
    ref_candidates.extend(["origin/main", "origin/master", "HEAD"])

    log_ref = "HEAD"
    for candidate in ref_candidates:
        ok_ref, _, _, _ = _git_run(["rev-parse", "--verify", candidate])
        if ok_ref:
            log_ref = candidate
            break

    ok_log, log_out, err_log, _ = _git_run(
        [
            "log",
            log_ref,
            f"-n{limit}",
            "--pretty=format:%H\t%h\t%ci\t%an\t%s",
        ]
    )
    if not ok_log:
        return jsonify({"error": err_log or "failed to list commits", "fetch_error": fetch_error}), 500

    status = _git_status_payload()
    commits = []
    for line in log_out.splitlines():
        parts = line.split("\t", 4)
        if len(parts) < 5:
            continue
        full, short, date, author, subject = parts
        commits.append({
            "hash": full,
            "short": short,
            "date": date,
            "author": author,
            "subject": subject,
            "is_head": full == status.get("head"),
        })

    return jsonify({
        "status": "ok",
        "ref": log_ref,
        "commits": commits,
        "git": status,
        "fetch_error": fetch_error,
    })


@app.route("/api/git/checkout", methods=["POST"])
def api_git_checkout():
    payload = request.get_json(silent=True) or {}
    commit = str(payload.get("commit") or "").strip()
    force = bool(payload.get("force"))
    confirm = str(payload.get("confirm_phrase") or "").strip()

    if not commit or not GIT_SHA_RE.match(commit):
        return jsonify({"error": "commit must be a git SHA (7-40 hex chars)"}), 400

    if force and confirm != GIT_FORCE_PHRASE:
        return jsonify({
            "error": f'type "{GIT_FORCE_PHRASE}" to confirm force checkout',
            "needs_force": True,
        }), 400

    ok_fetch, _, err_fetch, _ = _git_run(["fetch", "--prune", "origin"], timeout=120)
    if not ok_fetch:
        return jsonify({"error": f"git fetch failed: {err_fetch}"}), 500

    ok_rev, resolved, err_rev, _ = _git_run(["rev-parse", "--verify", f"{commit}^{{commit}}"])
    if not ok_rev:
        return jsonify({"error": f"unknown commit: {err_rev or commit}"}), 400

    status_before = _git_status_payload()
    if not force and status_before.get("dirty"):
        return jsonify({
            "error": "working tree has local changes; force checkout required",
            "needs_force": True,
            "force_phrase": GIT_FORCE_PHRASE,
            "git": status_before,
        }), 409

    if not force and status_before.get("head") == resolved:
        return jsonify({
            "status": "ok",
            "message": "already at selected commit",
            "git": status_before,
            "restart_recommended": False,
        })

    reset_args = ["reset", "--hard", resolved]
    ok_reset, out_reset, err_reset, _ = _git_run(reset_args, timeout=120)
    if not ok_reset:
        # Soft path failed (e.g. unexpected lock); tell UI to force.
        return jsonify({
            "error": err_reset or out_reset or "git reset failed",
            "needs_force": True,
            "force_phrase": GIT_FORCE_PHRASE,
            "git": _git_status_payload(),
        }), 409

    if force:
        # Drop untracked leftovers that would still look dirty after hard reset.
        _git_run(["clean", "-fd"], timeout=60)

    status_after = _git_status_payload()
    return jsonify({
        "status": "ok",
        "message": (
            f"{'Force-checked out' if force else 'Checked out'} "
            f"{status_after.get('head_short') or resolved[:7]}"
        ),
        "forced": force,
        "git": status_after,
        "restart_recommended": True,
    })


@app.route("/api/ku/jtag_freq", methods=["POST"])
@_require_host_registered
def api_set_ku_jtag_freq():
    payload = request.get_json(silent=True) or {}
    try:
        freq = int(payload.get("jtag_freq_hz"))
    except (TypeError, ValueError):
        return jsonify({"error": "jtag_freq_hz must be an integer"}), 400

    if freq not in KU_JTAG_FREQ_CHOICES:
        return jsonify({
            "error": f"unsupported frequency {freq}",
            "jtag_freq_choices": list(KU_JTAG_FREQ_CHOICES),
        }), 400

    HW_CONFIG.setdefault("ku", {})["jtag_freq_hz"] = freq
    ALL_HW_CONFIGS[HOSTNAME] = HW_CONFIG
    try:
        persist_hw_configs(HW_CONFIG_PATH, ALL_HW_CONFIGS)
    except Exception as exc:
        return jsonify({"error": f"failed to save hw_config: {exc}"}), 500

    return jsonify({
        "status": "ok",
        "jtag_freq_hz": freq,
        "hw_config": HW_CONFIG,
    })


@app.route("/api/ku/cables", methods=["GET"])
def api_list_ku_cables():
    """List Digilent cables via Vivado. Allowed even before host registration
    so Advanced options can fill KU serial fields during setup."""
    tools = _detect_tools()
    if not tools["vivado"]["available"]:
        return jsonify({
            "error": "Vivado Lab is not available on this host",
            "tools": tools,
            "cables": [],
        }), 503

    cables, error = _list_ku_cables_via_vivado()
    if error:
        return jsonify({"error": error, "cables": cables or []}), 500

    sides = (HW_CONFIG or {}).get("ku", {}).get("sides", {}) if HOST_REGISTERED else {}
    return jsonify({
        "cables": cables,
        "default_cables": {
            "a": (sides.get("a") or {}).get("serial"),
            "b": (sides.get("b") or {}).get("serial"),
        },
        "jtag_freq_hz": (
            (HW_CONFIG or {}).get("ku", {}).get("jtag_freq_hz") if HOST_REGISTERED else None
        ) or 15_000_000,
        "host_registered": HOST_REGISTERED,
    })


def _ku_firmware_payload():
    bin_dir = ku_bin_dir(RESOURCES_FOLDER)
    active = current_set_name(HW_CONFIG)
    sets = list_firmware_sets(bin_dir)
    return {
        "sets": sets,
        "details": list_firmware_details(bin_dir),
        "active": active,
        "active_present": bool(active and active in sets),
    }


@app.route("/api/ku/firmware", methods=["GET"])
def api_list_ku_firmware():
    return jsonify(_ku_firmware_payload())


@app.route("/api/ku/firmware/upload", methods=["POST"])
def api_upload_ku_firmware():
    tag = sanitize_tag(request.form.get("tag"))
    if not tag:
        return jsonify({
            "error": "tag is required (letters, numbers, . _ - ; max 64 chars)",
        }), 400

    allow_bin_only = str(request.form.get("allow_bin_only") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }

    uploaded = request.files.getlist("files") or []
    if not uploaded:
        # also accept named fields
        for key in ("bit", "bin", "ltx", "file", "files[]"):
            value = request.files.get(key)
            if value is not None:
                uploaded.append(value)

    pairs = [(f.filename, f) for f in uploaded if f and f.filename]
    stem, result = validate_upload_files(pairs, allow_bin_only=allow_bin_only)
    if stem is None:
        return jsonify({"error": result}), 400

    set_name, error = save_firmware_set(
        ku_bin_dir(RESOURCES_FOLDER),
        stem,
        tag,
        result,
    )
    if error:
        return jsonify({"error": error}), 400

    payload = _ku_firmware_payload()
    payload.update({
        "status": "ok",
        "set": set_name,
        "bin_only": set(result.keys()) == {"bin"},
    })
    return jsonify(payload), 201


@app.route("/api/ku/firmware/download", methods=["GET"])
def api_download_ku_firmware():
    active = current_set_name(HW_CONFIG)
    if not active:
        return jsonify({"error": "no active firmware set configured"}), 404

    buffer, error = build_firmware_zip(ku_bin_dir(RESOURCES_FOLDER), active)
    if error:
        return jsonify({"error": error}), 404

    return send_file(
        buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{active}.zip",
    )


@app.route("/api/ku/firmware/select", methods=["POST"])
def api_select_ku_firmware():
    payload = request.get_json(silent=True) or {}
    set_name = (payload.get("set") or "").strip()
    if not set_name:
        return jsonify({"error": "set name is required"}), 400

    ok, error = apply_firmware_set(HW_CONFIG, ku_bin_dir(RESOURCES_FOLDER), set_name)
    if not ok:
        return jsonify({"error": error}), 400

    ALL_HW_CONFIGS[HOSTNAME] = HW_CONFIG
    try:
        persist_hw_configs(HW_CONFIG_PATH, ALL_HW_CONFIGS)
    except Exception as exc:
        return jsonify({"error": f"failed to save hw_config: {exc}"}), 500

    response = _ku_firmware_payload()
    response.update({
        "status": "ok",
        "active": set_name,
        "hw_config": HW_CONFIG,
    })
    return jsonify(response)


@app.route("/api/ku/firmware/delete", methods=["POST"])
def api_delete_ku_firmware():
    payload = request.get_json(silent=True) or {}
    set_name = (payload.get("set") or "").strip()
    confirm = (payload.get("confirm") or "").strip()

    if not set_name:
        return jsonify({"error": "set name is required"}), 400
    if confirm != "delete me":
        return jsonify({"error": 'confirmation text must be exactly "delete me"'}), 400

    ok, error = delete_firmware_set(ku_bin_dir(RESOURCES_FOLDER), set_name)
    if not ok:
        return jsonify({"error": error}), 400

    response = _ku_firmware_payload()
    response.update({
        "status": "ok",
        "deleted": set_name,
    })
    return jsonify(response)


@app.route("/api/component_lots", methods=["GET"])
def api_component_lots():
    return jsonify(get_component_lots_by_type())


@app.route("/api/daughterboard/lookup", methods=["POST"])
def api_lookup_daughterboard():
    payload = request.get_json(silent=True) or {}
    result = lookup_daughterboard_pair(
        payload.get("dna_a"),
        payload.get("dna_b"),
    )
    status_code = 200 if result["status"] in ("matched", "partial") else 400
    return jsonify(result), status_code


@app.route("/api/daughterboard/register", methods=["POST"])
def api_register_daughterboard():
    payload = request.get_json(silent=True) or {}
    ok, error, daughterboard = register_daughterboard(
        payload.get("serial_no"),
        payload.get("dna_a"),
        payload.get("dna_b"),
        payload.get("fields"),
    )
    if not ok:
        return jsonify({"error": error or "registration failed"}), 400

    return jsonify({"status": "ok", "daughterboard": daughterboard}), 201


@app.route("/api/daughterboard/<int:serial_no>", methods=["GET"])
def api_get_daughterboard(serial_no):
    row = get_daughterboard_by_serial(serial_no)
    if not row:
        return jsonify({"error": "daughterboard not found"}), 404

    return jsonify({"daughterboard": serialize_daughterboard(row)})


@app.route("/api/daughterboard/<int:serial_no>/test_flags", methods=["PATCH"])
def api_update_daughterboard_test_flag(serial_no):
    payload = request.get_json(silent=True) or {}
    field = payload.get("field")
    value = payload.get("value")

    try:
        value = int(value)
    except (TypeError, ValueError):
        return jsonify({"error": "value must be 0 or 1"}), 400

    ok, error = update_daughterboard_test_flag(serial_no, field, value)
    if not ok:
        return jsonify({"error": error or "update failed"}), 400

    row = get_daughterboard_by_serial(serial_no)
    return jsonify({"status": "ok", "daughterboard": serialize_daughterboard(row)})


@app.route("/api/daughterboard/<int:serial_no>", methods=["PATCH"])
def api_patch_daughterboard(serial_no):
    payload = request.get_json(silent=True) or {}
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        return jsonify({"error": "fields object is required"}), 400

    ok, error = update_daughterboard_fields(serial_no, fields)
    if not ok:
        return jsonify({"error": error or "update failed"}), 400

    row = get_daughterboard_by_serial(serial_no)
    return jsonify({"status": "ok", "daughterboard": serialize_daughterboard(row)})


@app.route("/api/detect_digilent", methods=["GET"])
def api_detect_digilent():
    return jsonify(detect_digilent_programmers())


@app.route("/api/detect_flashpro", methods=["GET"])
def api_detect_flashpro():
    return jsonify(detect_flashpro_programmers())


@app.route("/api/detect_programmers", methods=["GET"])
def api_detect_programmers():
    return jsonify(detect_programmers())


@app.route("/api/system_usage", methods=["GET"])
def system_usage():
    return jsonify({
        "cpu": psutil.cpu_percent(interval=None),
        "ram": psutil.virtual_memory().percent,
    })


def _ha_entity_for_side(side):
    return SIDE_TO_HA_ENTITY.get(side.upper())


@app.route("/api/refresh_processes", methods=["POST"])
def refresh_processes():
    killed = _kill_named_processes(_PROCESS_NAMES_TO_KILL)
    return jsonify({
        "status": "ok",
        "killed": [item["name"] for item in killed],
        "killed_detail": killed,
        "counts": _count_named_processes(),
    })


@app.route("/api/process_status", methods=["GET"])
def api_process_status():
    return jsonify({
        "status": "ok",
        "processes": sorted(_PROCESS_NAMES_TO_KILL),
        "counts": _count_named_processes(),
    })


@app.route("/api/kill_process", methods=["POST"])
def api_kill_process():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    if name not in _PROCESS_NAMES_TO_KILL:
        return jsonify({
            "error": f"unsupported process: {name}",
            "allowed": sorted(_PROCESS_NAMES_TO_KILL),
        }), 400

    killed = _kill_named_processes({name})
    return jsonify({
        "status": "ok",
        "name": name,
        "killed": [item["name"] for item in killed],
        "killed_detail": killed,
        "counts": _count_named_processes(),
    })


@app.route("/api/restart_service", methods=["POST"])
def api_restart_service():
    payload = request.get_json(silent=True) or {}
    service = str(payload.get("service") or "").strip()
    if service not in _SERVICE_RESTART_ALLOWLIST:
        return jsonify({
            "error": f"unsupported service: {service}",
            "allowed": sorted(_SERVICE_RESTART_ALLOWLIST),
        }), 400

    try:
        service_status = _restart_local_service(service)
    except Exception as e:
        print(f"Error calling service restart ({service}): {e}")
        return jsonify({"status": "error", "service": service, "error": str(e)}), 500

    return jsonify({"status": "ok", "service": service, "result": service_status})


@app.route("/api/restart_tile_wjtag", methods=["POST"])
def restart_tile_wjtag():
    try:
        service_status = _restart_local_service("tile-wjtag")
    except Exception as e:
        print(f"Error calling service restart: {e}")
        service_status = f"error: {e}"

    return jsonify({"status": "ok", "service": service_status})


@app.route("/api/power_states", methods=["GET"])
def get_power_states():
    states = {}
    errors = {}

    for side_key, entity_id in SIDE_TO_HA_ENTITY.items():
        side = side_key.lower()
        try:
            states[side] = ha.get_state_value(entity_id)
        except Exception as e:
            states[side] = "unknown"
            errors[side] = str(e)

    payload = {"states": states}
    if errors:
        payload["errors"] = errors
        return jsonify(payload), 500
    return jsonify(payload)


@app.route("/api/power_state/<side>", methods=["GET"])
def get_power_state(side):
    entity_id = _ha_entity_for_side(side)
    if not entity_id:
        return jsonify({"error": "invalid side"}), 400

    try:
        state = ha.get_state_value(entity_id)
        return jsonify({"state": state})
    except Exception as e:
        return jsonify({"state": "unknown", "error": str(e)}), 500


@app.route("/api/power_toggle/<side>", methods=["POST"])
def toggle_power(side):
    entity_id = _ha_entity_for_side(side)
    if not entity_id:
        return jsonify({
            "error": f"HA entity for side {side} is not registered",
        }), 400

    try:
        ha.call_service(
            domain="switch",
            service="toggle",
            data={"entity_id": entity_id},
        )
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=8888,
        debug=True,
        threaded=True,
    )
