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


def run_process(command, source_type):

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

    error_detected = False
    success_detected = False

    try:
        with os.fdopen(master_fd) as stdout:
            while True:
                try:
                    line = stdout.readline()
                    if not line:
                        break

                    # Detect errors
                    if any(x in line for x in ["Error", "ERROR", "Failed", "FAIL"]):
                        error_detected = True

                    # Detect success keywords
                    if any(x in line for x in ["PASSED", "completed successfully"]):
                        success_detected = True

                    yield {
                        "source": source_type,
                        "line": line
                    }

                except OSError as e:
                    if e.errno == errno.EIO:
                        # Expected when PTY closes
                        break
                    else:
                        raise

    finally:
        process.wait()

    # Determine final status
    if error_detected:
        status = "failure"
    elif success_detected:
        status = "success"
    else:
        status = "success" if process.returncode == 0 else "failure"

    yield {
        "source": source_type,
        "status": status
    }
    
    
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

