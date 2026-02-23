import pty
import os
import subprocess
import errno

import threading
import queue
import json
from datetime import datetime

from flask import Flask, render_template, Response, request

app = Flask(__name__)

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


os.makedirs(VIVADO_LOG_FOLDER, exist_ok=True)
os.makedirs(VIVADO_TCL_FOLDER, exist_ok=True)
os.makedirs(FPEXPRESS_LOG_FOLDER, exist_ok=True)
os.makedirs(FPEXPRESS_TCL_FOLDER, exist_ok=True)


VIVADO_SETTINGS = "/tools/Xilinx/Vivado_Lab/2022.2/settings64.sh"
FLASH_PRO_CMD = "/microsemi/Libero_SoC_11.10/Libero_SoC/Designer/bin/FPExpress"


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
    side_status = {}  # "A" or "B"
    try:
        with os.fdopen(master_fd) as stdout:
            for line in stdout:
                yield {"source": "proasic", "line": line}

                # Match PASSED/FAILED lines
                match = re.match(
                    r"programmer\s+'(tile-fp5-0[12])'.*?\s(PASSED|FAILED)",
                    line,
                    re.I
                )
                if match:
                    side = "A" if match[1] == "tile-fp5-01" else "B"
                    side_status[side] = "success" if match[2].upper() == "PASSED" else "failure"

    except OSError as e:
        if e.errno != errno.EIO:
            raise

    finally:
        process.wait()

    # Overall LED status
    status = "failure" if "failure" in side_status.values() else "success"
    yield {"source": "proasic", "status": status, "side_status": side_status}


# -----------------------------
# Xilinx KU handler
# -----------------------------
def _run_process_ku(process, master_fd):
    side_status = {}  # DNA-based
    try:
        with os.fdopen(master_fd) as stdout:
            for line in stdout:
                yield {"source": "ku", "line": line}

                # Match tile success/failure
                match = re.match(
                    r"\((210249B06E36|210249B07138)\) Tile Operation (Success|Failure)!",
                    line
                )
                if match:
                    serial = match[1]
                    side_status[serial] = "success" if match[2] == "Success" else "failure"

    except OSError as e:
        if e.errno != errno.EIO:
            raise

    finally:
        process.wait()

    # Overall LED status
    if error_detected:
        status = "failure"
    elif success_detected:
        status = "success"
    else:
        # status = "success" if process.returncode == 0 else "failure"
        status = "failure"

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
        
        tcl = os.path.join(VIVADO_TCL_FOLDER, "get_ku_properties.tcl")
        
        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "vivado"
        
    elif action == "program_ku":
        
        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")

        tcl = os.path.join(VIVADO_TCL_FOLDER, "program_ku.tcl")

        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "vivado"

    elif action == "program_ku_flash":
        
        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")

        tcl = os.path.join(VIVADO_TCL_FOLDER, "program_ku_flash.tcl")

        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "vivado"
        
    elif action == "verify_ku_flash":

        log_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.log")
        jou_file = os.path.join(VIVADO_LOG_FOLDER, f"vivado_{timestamp}_{action}.jou")

        tcl = os.path.join(VIVADO_TCL_FOLDER, "verify_ku_flash.tcl")

        return (
            f"bash -c 'source {VIVADO_SETTINGS} && "
            f"vivado_lab -mode batch -log {log_file} -journal {jou_file} -source {tcl}'"
        ), "vivado"


    elif action == "get_proasic_info":
        
        tcl = os.path.join(FPEXPRESS_TCL_FOLDER, "device_info.tcl")
        log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")

        cmd = (
            f'xvfb-run -a {FLASH_PRO_CMD} '
            f'script:"{tcl}" '
            f'console_mode:show '
            f'logfile:"{log_file}"'
        )

        return cmd, "flashpro"

    elif action == "verify_proasic":
        tcl = os.path.join(FPEXPRESS_TCL_FOLDER, "verify_device.tcl")
        log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")

        cmd = (
            f'xvfb-run -a {FLASH_PRO_CMD} '
            f'script:"{tcl}" '
            f'console_mode:show '
            f'logfile:"{log_file}"'
        )
        return cmd, "flashpro"

    elif action == "program_proasic":
        tcl = os.path.join(FPEXPRESS_TCL_FOLDER, "program_device.tcl")
        log_file = os.path.join(FPEXPRESS_LOG_FOLDER, f"fpexpress_{timestamp}_{action}.log")

        cmd = (
            f'xvfb-run -a {FLASH_PRO_CMD} '
            f'script:"{tcl}" '
            f'console_mode:show '
            f'logfile:"{log_file}"'
        )
        return cmd, "flashpro"

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

