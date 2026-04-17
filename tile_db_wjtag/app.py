import pty
import os
import subprocess
import errno
import socket
import requests

from lib.hw import *
from lib.mariadb import *
from lib.ha import HomeAssistantClient


import threading
import queue
import json
from datetime import datetime

from flask import Flask, render_template, Response, request, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix

import psutil
import signal



HA_URL = "http://ha.piro-atlas-lab.fysik.su.se:8123"
HA_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI4YjEyZWE1Yzc4NTE0Y2FmODRlNWQzYWQwMmIzZTNjNyIsImlhdCI6MTc3MTIxODg3MCwiZXhwIjoyMDg2NTc4ODcwfQ.7BnKN_KS1Pa5SuKWXXDv2xoZtkSH05ttgAq3OSzCQdk"

ha = HomeAssistantClient(
    base_url=HA_URL,
    token=HA_TOKEN,
    timeout=5
)

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_prefix=1)
# app.wsgi_app = ProxyFix(app.wsgi_app)
# app.config['APPLICATION_ROOT'] = '/fpga-prog-station-1'



BASE_DIR = os.path.dirname(os.path.abspath(__file__))


RESOURCES_FOLDER = os.path.join(BASE_DIR, "resources")
print(f"RESOURCES_FOLDER: {RESOURCES_FOLDER}")
KU_BIN_FOLDER = os.path.join(RESOURCES_FOLDER, "ku/bin")
print(f"KU_BIN_FOLDER: {KU_BIN_FOLDER}")
VIVADO_LOG_FOLDER = os.path.join(RESOURCES_FOLDER, "ku/logs/vivado")
print(f"VIVADO_LOG_FOLDER: {VIVADO_LOG_FOLDER}")
VIVADO_TCL_FOLDER = os.path.join(RESOURCES_FOLDER, "ku/tcl")
print(f"VIVADO_TCL_FOLDER: {VIVADO_TCL_FOLDER}")
VIVADO_CONFIG_FOLDER = os.path.join(RESOURCES_FOLDER, "ku")
print(f"VIVADO_CONFIG_FOLDER: {VIVADO_CONFIG_FOLDER}")

PROASIC_BIN_FOLDER = os.path.join(RESOURCES_FOLDER, "proasic/bin")
print(f"PROASIC_BIN_FOLDER: {PROASIC_BIN_FOLDER}")
FPEXPRESS_LOG_FOLDER = os.path.join(RESOURCES_FOLDER, "proasic/logs/fpexpress")
print(f"FPEXPRESS_LOG_FOLDER: {FPEXPRESS_LOG_FOLDER}")
FPEXPRESS_TCL_FOLDER = os.path.join(RESOURCES_FOLDER, "proasic/tcl")
print(f"FPEXPRESS_TCL_FOLDER: {FPEXPRESS_TCL_FOLDER}")
HW_CONFIG_PATH = os.path.join(RESOURCES_FOLDER, "hw_config.json")

os.makedirs(VIVADO_LOG_FOLDER, exist_ok=True)
os.makedirs(VIVADO_TCL_FOLDER, exist_ok=True)
os.makedirs(FPEXPRESS_LOG_FOLDER, exist_ok=True)
os.makedirs(FPEXPRESS_TCL_FOLDER, exist_ok=True)

VIVADO_SETTINGS = "/tools/Xilinx/Vivado_Lab/2022.2/settings64.sh"
FLASH_PRO_CMD = "/microsemi/Libero_SoC_11.10/Libero_SoC/Designer/bin/FPExpress"

with open(HW_CONFIG_PATH, "r") as f:
# Load all server configs
    ALL_HW_CONFIGS = json.load(f)

# Get the current server hostname
HOSTNAME = socket.gethostname()

# Pick the matching config, or fallback
HW_CONFIG = ALL_HW_CONFIGS.get(HOSTNAME)
if HW_CONFIG is None:
    raise RuntimeError(f"No hardware config found for hostname: {HOSTNAME}")

# Build lookup maps
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
    side.upper(): entity
    for side, entity in ha_cfg.items()
}



print(f"Loaded hardware config for {HOSTNAME}")


job_queue = queue.Queue()


# ===============================
# PROCESS EXECUTION
# ===============================

import os
import pty
import subprocess
import errno
import re

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
        close_fds=True
    )

    os.close(slave_fd)

    # Dispatch to per-FPGA type handler
    if source_type == "proasic":
        yield from _run_process_proasic(process, master_fd)
    elif source_type == "ku":
        yield from _run_process_ku(process, master_fd)
    else:
        yield from _run_process_generic(process, master_fd)


# -----------------------------
# ProASIC handler
# -----------------------------
def _run_process_proasic(process, master_fd):
    side_status = {}

    # Create dynamic regex from config
    programmers = "|".join(map(re.escape, PROASIC_PROG_TO_SIDE.keys()))
    pattern = re.compile(
        rf"programmer\s+'({programmers})'.*?\s(PASSED|FAILED)",
        re.I
    )

    try:
        with os.fdopen(master_fd) as stdout:
            for line in stdout:
                yield {"source": "proasic", "line": line}

                match = pattern.search(line)
                if match:
                    programmer = match.group(1)
                    result = match.group(2).upper()

                    side = PROASIC_PROG_TO_SIDE.get(programmer)
                    if side:
                        side_status[side] = (
                            "success" if result == "PASSED" else "failure"
                        )

    except OSError as e:
        if e.errno != errno.EIO:
            raise
    finally:
        process.wait()

    status = "failure" if "failure" in side_status.values() else "success"

    yield {
        "source": "proasic",
        "status": status,
        "side_status": side_status
    }


# -----------------------------
# Xilinx KU handler
# -----------------------------
def _run_process_ku(process, master_fd):
    side_status = {}

    serials = "|".join(map(re.escape, KU_SERIAL_TO_SIDE.keys()))
    result_pattern = re.compile(rf"\(({serials})\) Tile Operation (Success|Failure)!")
    dna_pattern = re.compile(rf"\(({serials})\).*FUSE_DNA\s*=\s*([0-9A-F]+)")

    try:
        with os.fdopen(master_fd) as stdout:
            for line in stdout:
                yield {"source": "ku", "line": line.strip()}

                # --- Check DNA ---
                dna_match = dna_pattern.search(line)
                if dna_match:
                    serial = dna_match.group(1)
                    dna = dna_match.group(2)

                    # Yield raw DNA info
                    yield {"source": "ku", "line": f"Found DNA for {serial}: {dna}"}

                    # Check DB for this DNA
                    db_info = check_dna_in_db(dna)

                    expected_side = KU_SERIAL_TO_SIDE.get(serial)

                    if db_info:

                        db_side = db_info["side"]

                        if db_side != expected_side:
                            # WRONG SIDE ERROR
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
                                "expected_side": expected_side
                            }

                        else:
                            # Correct match
                            yield {
                                "source": "ku",
                                "line": (
                                    f"DNA {dna} correctly registered for side {db_side}, "
                                    f"Serial: {db_info['serial_no']}, Batch: {db_info['batch_id']}"
                                ),
                                "db_status": "registered",
                                "serial_no": db_info["serial_no"],
                                "batch_id": db_info["batch_id"],
                                "side": db_side
                            }

                    else:
                        yield {
                            "source": "ku",
                            "line": f"DNA {dna} is NOT registered in DB",
                            "db_status": "unregistered",
                            "dna": dna
                        }
                # --- Check operation result ---
                result_match = result_pattern.search(line)
                if result_match:
                    serial = result_match.group(1)
                    result = result_match.group(2)

                    side = KU_SERIAL_TO_SIDE.get(serial)
                    if side:
                        side_status[side] = "success" if result == "Success" else "failure"

    except OSError as e:
        if e.errno != errno.EIO:
            raise
    finally:
        process.wait()

    status = "failure" if "failure" in side_status.values() else "success"

    yield {"source": "ku", "status": status, "side_status": side_status}


# -----------------------------
# Generic fallback (just stream)
# -----------------------------
def _run_process_generic(process, master_fd):
    try:
        with os.fdopen(master_fd) as stdout:
            for line in stdout:
                yield {"source": "generic", "line": line}
    except OSError as e:
        if e.errno != errno.EIO:
            raise
    finally:
        process.wait()
    yield {"source": "generic", "status": "success" if process.returncode == 0 else "failure"}


    
    
# ===============================
# COMMAND ROUTING
# ===============================

def build_command(action):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    
    if action == "get_ku_properties":
        
        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")
        
        print(f"Log file: {log_file}")
        
        tcl = os.path.join(VIVADO_TCL_FOLDER, "get_ku_properties.tcl")
        
        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "ku"
        
    elif action == "program_ku":
        
        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")

        tcl = os.path.join(VIVADO_TCL_FOLDER, "program_ku.tcl")

        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "ku"

    elif action == "program_ku_flash":
        
        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")

        tcl = os.path.join(VIVADO_TCL_FOLDER, "program_ku_flash.tcl")

        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "ku"
        
    elif action == "verify_ku_flash":

        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")

        tcl = os.path.join(VIVADO_TCL_FOLDER, "verify_ku_flash.tcl")

        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "ku"


    elif action == "get_proasic_info":
        
        tcl = os.path.join(FPEXPRESS_TCL_FOLDER, "device_info.tcl")
        log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")

        cmd = (
            f'xvfb-run -a {FLASH_PRO_CMD} '
            f'script:"{tcl}" '
            f'console_mode:show '
            f'logfile:"{log_file}"'
        )

        return cmd, "proasic"

    elif action == "verify_proasic":
        tcl = os.path.join(FPEXPRESS_TCL_FOLDER, "verify_device.tcl")
        log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")

        cmd = (
            f'xvfb-run -a {FLASH_PRO_CMD} '
            f'script:"{tcl}" '
            f'console_mode:show '
            f'logfile:"{log_file}"'
        )
        return cmd, "proasic"

    elif action == "program_proasic":
        tcl = os.path.join(FPEXPRESS_TCL_FOLDER, "program_device.tcl")
        log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")

        cmd = (
            f'xvfb-run -a {FLASH_PRO_CMD} '
            f'script:"{tcl}" '
            f'console_mode:show '
            f'logfile:"{log_file}"'
        )
        return cmd, "proasic"

    else:
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

@app.route('/api/get_hostname', methods=['GET'])
def get_hostname():
    try:
        # Get the actual system hostname of the server
        hostname = socket.gethostname()
        # print (f"Server hostname: {hostname}")
        return jsonify({'hostname': hostname})
    except Exception as e:
        # print(f"Error getting hostname: {e}")
        return jsonify({'hostname': 'Unknown Server'}), 500

@app.route("/api/hw_config", methods=["GET"])
def get_hw_config():
    return jsonify(HW_CONFIG)

@app.route("/api/detect_digilent", methods=["GET"])
def api_detect_digilent():
    return jsonify(detect_digilent_programmers())


@app.route("/api/detect_flashpro", methods=["GET"])
def api_detect_flashpro():
    return jsonify(detect_flashpro_programmers())


@app.route("/api/detect_programmers", methods=["GET"])
def api_detect_programmers():
    return jsonify({
        "digilent": detect_digilent_programmers(),
        "flashpro": detect_flashpro_programmers()
    })


@app.route("/api/system_usage", methods=["GET"])
def system_usage():
    cpu_percent = psutil.cpu_percent(interval=0.5)
    ram_percent = psutil.virtual_memory().percent
    return jsonify({"cpu": cpu_percent, "ram": ram_percent})

@app.route("/api/refresh_processes", methods=["POST"])
def refresh_processes():
    # Kill all vivado_lab and cs_server processes
    killed = []
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'] in ("vivado_lab", "cs_server", "FPExpress_bin"):
                os.kill(proc.info['pid'], signal.SIGTERM)
                killed.append(proc.info['name'])
        except Exception as e:
            print(f"Error killing process {proc.info['name']}: {e}")
    return jsonify({"status": "ok", "killed": killed})


@app.route("/api/restart_tile_wjtag", methods=["POST"])
def restart_tile_wjtag():
    try:
        response = requests.post(
            "http://127.0.0.1:8081/action",
            data={
                "service": "tile-wjtag",
                "action": "restart"
            },
            timeout=5
        )
        response.raise_for_status()
        service_status = "restarted"
    except Exception as e:
        print(f"Error calling service restart: {e}")
        service_status = f"error: {e}"

    return jsonify({
        "status": "ok",
        "service": service_status
    })


@app.route("/api/power_state/<side>", methods=["GET"])
def get_power_state(side):
    entity_id = SIDE_TO_HA_ENTITY.get(side.upper())
    if not entity_id:
        return jsonify({"error": "invalid side"}), 400

    try:
        state = ha.get_state_value(entity_id)
        return jsonify({"state": state})
    except Exception as e:
        return jsonify({"state": "unknown", "error": str(e)}), 500


@app.route("/api/power_toggle/<side>", methods=["POST"])
def toggle_power(side):
    entity_id = SIDE_TO_HA_ENTITY.get(side.upper())
    if not entity_id:
        return jsonify({"error": "invalid side"}), 400

    try:
        ha.call_service(
            domain="switch",
            service="toggle",
            data={"entity_id": entity_id}
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
        threaded=True
    )

