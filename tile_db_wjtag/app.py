import errno
import json
import os
import pty
import re
import signal
import socket
import subprocess
from datetime import datetime

import psutil
import requests
from flask import Flask, Response, jsonify, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

from lib.ha import HomeAssistantClient
from lib.hw import (
    detect_digilent_programmers,
    detect_flashpro_programmers,
    detect_programmers,
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
RESOURCES_FOLDER = os.path.join(BASE_DIR, "resources")

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
FLASH_PRO_CMD = "/microsemi/Libero_SoC_11.10/Libero_SoC/Designer/bin/FPExpress"

with open(HW_CONFIG_PATH, "r") as f:
    ALL_HW_CONFIGS = json.load(f)

HOSTNAME = socket.gethostname()

HW_CONFIG = ALL_HW_CONFIGS.get(HOSTNAME)
if HW_CONFIG is None:
    raise RuntimeError(f"No hardware config found for hostname: {HOSTNAME}")

KU_SERIAL_TO_SIDE = {
    v["serial"]: side.upper() for side, v in HW_CONFIG["ku"]["sides"].items()
}
PROASIC_PROG_TO_SIDE = {
    v["programmer"]: side.upper() for side, v in HW_CONFIG["proasic"]["sides"].items()
}
ha_cfg = HW_CONFIG.get("ha_power_control", {}).get("sides", {})

if not isinstance(ha_cfg, dict):
    raise RuntimeError("Invalid ha_power_control config")

SIDE_TO_HA_ENTITY = {
    side.upper(): entity for side, entity in ha_cfg.items()
}

_KU_SERIALS = "|".join(map(re.escape, KU_SERIAL_TO_SIDE))
KU_RESULT_PATTERN = re.compile(
    rf"\(({_KU_SERIALS})\) Tile Operation (Success|Failure)!"
)
KU_DNA_PATTERN = re.compile(
    rf"\(({_KU_SERIALS})\).*FUSE_DNA\s*=\s*([0-9A-F]+)"
)
_PROASIC_PROGRAMMERS = "|".join(map(re.escape, PROASIC_PROG_TO_SIDE))
PROASIC_RESULT_PATTERN = re.compile(
    rf"programmer\s+'({_PROASIC_PROGRAMMERS})'.*?\s(PASSED|FAILED)",
    re.I,
)

KU_ACTIONS = {
    "get_ku_properties": "get_ku_properties.tcl",
    "program_ku": "program_ku.tcl",
    "program_ku_flash": "program_ku_flash.tcl",
    "verify_ku_flash": "verify_ku_flash.tcl",
}

PROASIC_ACTIONS = {
    "get_proasic_info": "device_info.tcl",
    "verify_proasic": "verify_device.tcl",
    "program_proasic": "program_device.tcl",
}

_PROCESS_NAMES_TO_KILL = frozenset({"vivado_lab", "cs_server", "FPExpress_bin"})

# Prime CPU counter so later reads are non-blocking.
psutil.cpu_percent()

print(f"Loaded hardware config for {HOSTNAME}")


# ===============================
# PROCESS EXECUTION
# ===============================

def run_process(command, source_type):
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
        yield from _run_process_ku(process, master_fd)
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

        match = PROASIC_RESULT_PATTERN.search(line)
        if not match:
            continue

        programmer = match.group(1)
        result = match.group(2).upper()
        side = PROASIC_PROG_TO_SIDE.get(programmer)
        if side:
            side_status[side] = "success" if result == "PASSED" else "failure"

    status = "failure" if "failure" in side_status.values() else "success"
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


def _run_process_ku(process, master_fd):
    side_status = {}
    dna_cache = {}
    registered_sides = {}
    daughterboard_announced = False

    for line in _read_pty_lines(process, master_fd):
        yield {"source": "ku", "line": line.strip()}

        dna_match = KU_DNA_PATTERN.search(line)
        if dna_match:
            serial = dna_match.group(1)
            dna = dna_match.group(2)

            yield {"source": "ku", "line": f"Found DNA for {serial}: {dna}"}

            if dna not in dna_cache:
                dna_cache[dna] = check_dna_in_db(dna)
            db_info = dna_cache[dna]
            expected_side = KU_SERIAL_TO_SIDE.get(serial)

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

        result_match = KU_RESULT_PATTERN.search(line)
        if result_match:
            serial = result_match.group(1)
            result = result_match.group(2)
            side = KU_SERIAL_TO_SIDE.get(serial)
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

def _build_vivado_command(action, timestamp):
    log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
    jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")
    tcl = os.path.join(VIVADO_TCL_FOLDER, KU_ACTIONS[action])
    return (
        f"bash -c 'source {VIVADO_SETTINGS} && "
        f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
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


def build_command(action):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    if action in KU_ACTIONS:
        if action == "get_ku_properties":
            log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
            print(f"Log file: {log_file}")
        return _build_vivado_command(action, timestamp), "ku"

    if action in PROASIC_ACTIONS:
        return _build_fpexpress_command(action, timestamp, PROASIC_ACTIONS[action]), "proasic"

    return None, None


# ===============================
# STREAM ENDPOINT
# ===============================

@app.route("/run/<action>")
def run_action(action):
    command, source_type = build_command(action)

    if not command:
        return "Invalid action", 400

    def event_stream():
        for output in run_process(command, source_type):
            yield f"data: {json.dumps(output)}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/api/get_hostname", methods=["GET"])
def get_hostname():
    try:
        return jsonify({"hostname": HOSTNAME})
    except Exception:
        return jsonify({"hostname": "Unknown Server"}), 500


@app.route("/api/hw_config", methods=["GET"])
def get_hw_config():
    return jsonify(HW_CONFIG)


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
    status_code = 200 if result["status"] == "matched" else 400
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
    killed = []
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            name = proc.info["name"]
            if name in _PROCESS_NAMES_TO_KILL:
                os.kill(proc.info["pid"], signal.SIGTERM)
                killed.append(name)
        except Exception as e:
            print(f"Error killing process {proc.info.get('name')}: {e}")
    return jsonify({"status": "ok", "killed": killed})


@app.route("/api/restart_tile_wjtag", methods=["POST"])
def restart_tile_wjtag():
    try:
        response = requests.post(
            "http://127.0.0.1:8081/action",
            data={
                "service": "tile-wjtag",
                "action": "restart",
            },
            timeout=5,
        )
        response.raise_for_status()
        service_status = "restarted"
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
        return jsonify({"error": "invalid side"}), 400

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
