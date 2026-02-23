import os
import subprocess
import queue
import threading
import traceback
from datetime import datetime

# ==============================
# Configuration
# ==============================

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))

UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads_proasic")
LOG_FOLDER = os.path.join(BASE_DIR, "flashpro_logs")
TCL_FOLDER = os.path.join(BASE_DIR, "tcl_proasic")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(LOG_FOLDER, exist_ok=True)
os.makedirs(TCL_FOLDER, exist_ok=True)

FLASH_PRO_EXE = r"C:\Microsemi\Libero_SoC_v11.9\Designer\bin\flashpro.exe"
SCRIPT_NAME = "program-proasic-fpga"

job_queue = queue.Queue()

# ==============================
# Utility
# ==============================

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in {"jed", "stp"}


def get_timestamp():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


# ==============================
# TCL Generator
# ==============================

def generate_tcl_script(job_config, timestamp):
    """
    Generates a TCL script to program ProASIC FPGA
    using FlashPro batch mode.
    """

    tcl_filename = f"{SCRIPT_NAME}_{timestamp}.tcl"
    tcl_path = os.path.join(TCL_FOLDER, tcl_filename)

    jed_path = job_config["jed_path"]

    tcl_script = (
        "puts \"=== Starting ProASIC Programming ===\"\n\n"
        "new_project -name {web_project} "
        f"-location {{{TCL_FOLDER}}} -mode {{single}}\n\n"

        "puts \"Refreshing programmer list...\"\n"
        "refresh_prg_list\n\n"

        "puts \"Pinging programmers...\"\n"
        "ping_prg\n\n"

        f"puts \"Setting programming file: {jed_path}\"\n"
        f"set_programming_file -file {{{jed_path}}}\n\n"

        "puts \"Selecting PROGRAM action\"\n"
        "set_programming_action -action {PROGRAM}\n\n"

        "puts \"Running programming...\"\n"
        "run_selected_actions\n\n"

        "puts \"Closing project...\"\n"
        "close_project\n\n"

        "puts \"=== ProASIC Programming Finished ===\"\n"
    )

    with open(tcl_path, "w") as f:
        f.write(tcl_script)

    return tcl_path


# ==============================
# FlashPro Streaming + Logging
# ==============================

def stream_flashpro(job_config):
    timestamp = get_timestamp()
    log_filename = f"{SCRIPT_NAME}_{timestamp}.log"
    log_path = os.path.join(LOG_FOLDER, log_filename)

    try:
        tcl_path = generate_tcl_script(job_config, timestamp)

        yield {"type": "log", "line": f"Log file: {log_path}\n"}
        yield {"type": "log", "line": f"TCL file: {tcl_path}\n\n"}

        with open(log_path, "w") as logfile:

            def write_and_yield(text):
                logfile.write(text)
                logfile.flush()
                if not text.lstrip().startswith("#"):
                    return {"type": "log", "line": text}
                return None

            if not os.path.exists(FLASH_PRO_EXE):
                yield {"type": "log",
                       "line": f"ERROR: flashpro.exe not found: {FLASH_PRO_EXE}\n"}
                return

            cmd = [FLASH_PRO_EXE, f"script:{tcl_path}"]

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            for line in iter(process.stdout.readline, ''):
                result = write_and_yield(line)
                if result:
                    yield result

            process.stdout.close()
            process.wait()

            yield {"type": "log",
                   "line": "\n===== ProASIC Programming Finished =====\n"}

    except Exception:
        error_text = "\n===== Python Exception =====\n" + traceback.format_exc()
        yield {"type": "log", "line": error_text}
        with open(log_path, "a") as logfile:
            logfile.write(error_text)


# ==============================
# Job Queue
# ==============================

def enqueue_job(job_config):
    result_queue = queue.Queue()
    job_queue.put((job_config, result_queue))

    while True:
        line = result_queue.get()
        if line is None:
            break
        yield line


def job_worker():
    while True:
        job_config, result_queue = job_queue.get()
        try:
            for line in stream_flashpro(job_config):
                result_queue.put(line)
        except Exception as e:
            result_queue.put({
                "type": "log",
                "line": f"\n===== Worker Exception =====\n{str(e)}\n"
            })
        finally:
            result_queue.put(None)
            job_queue.task_done()


threading.Thread(target=job_worker, daemon=True).start()
