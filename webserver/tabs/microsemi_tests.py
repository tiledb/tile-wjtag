import os
import subprocess
import queue
import threading
import traceback
from datetime import datetime

# ==============================
# Configuration
# ==============================

BASE_DIR = "/home/tiledb/apps/tile-wjtag/tcl_proasic"

DEFAULT_PROJECT = "/home/tiledb/apps/tile-wjtag/bin/proasic/db7_proasic_fw_cm.pro"

FP_PROJECTS_BASE = os.path.join(BASE_DIR, "fp_projects_log")
LOG_FOLDER = os.path.join(BASE_DIR, "logged")
TCL_FOLDER = os.path.join(LOG_FOLDER, "tcl")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

FLASHPRO_EXPRESS = "/microsemi/Libero_SoC_11.10/Libero_SoC/Designer/bin/FPExpress"

SCRIPT_NAME = "flashpro_job"

for d in (FP_PROJECTS_BASE, LOG_FOLDER, TCL_FOLDER, UPLOAD_FOLDER):
    os.makedirs(d, exist_ok=True)

job_queue = queue.Queue()

# ==============================
# Utilities
# ==============================

def get_timestamp():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def generate_unique_fp_project_folder():
    """Generate a unique folder for FPExpress new_project command."""
    timestamp = get_timestamp()
    folder = os.path.join(FP_PROJECTS_BASE, f"job_{timestamp}")
    counter = 0
    while os.path.exists(folder):
        counter += 1
        folder = os.path.join(FP_PROJECTS_BASE, f"job_{timestamp}_{counter}")
    return folder


# ==============================
# TCL Builder (FPExpress Compatible)
# ==============================

def build_flashpro_tcl(action_list, project_file):
    """
    Generate TCL script compatible with FPExpress.
    
    Parameters
    ----------
    action_list : list of str
        Example: ["VERIFY", "DEVICE_INFO", "PROGRAM"]
    project_file : str
        Path to the .pro project file
    """
    project_name = os.path.splitext(os.path.basename("db7_proasic"))[0]

    lines = []
    lines.append(f"open_project -project {{{project_file}}} -connect_programmers 1")

    for act in action_list:
        lines.append(f"set_programming_action -name {{{project_name}}} -action {{{act}}}")
        lines.append("run_selected_actions")

    return "\n".join(lines)


# ==============================
# Stream Execution
# ==============================

def stream_flashpro(hw_server,
                    actions=None,
                    project_file=None):
    """
    Stream FPExpress execution logs line by line for Flask.
    
    Parameters
    ----------
    actions : list of str
        Actions to perform, e.g., ["VERIFY", "DEVICE_INFO", "PROGRAM"]
    project_file : str
        Path to .pro file
    """

    if actions is None:
        actions = ["VERIFY", "DEVICE_INFO", "PROGRAM"]

    if project_file is None:
        project_file = DEFAULT_PROJECT

    timestamp = get_timestamp()

    log_path = os.path.join(
        LOG_FOLDER,
        f"{SCRIPT_NAME}_{timestamp}.log"
    )

    tcl_path = os.path.join(
        TCL_FOLDER,
        f"{SCRIPT_NAME}_{timestamp}.tcl"
    )

    tcl_script = build_flashpro_tcl(actions, project_file)

    with open(tcl_path, "w") as f:
        f.write(tcl_script)

    yield {"type": "log", "line": f"Using project: {project_file}\n"}
    yield {"type": "log", "line": f"TCL script: {tcl_path}\n"}
    yield {"type": "log", "line": f"Log file: {log_path}\n\n"}

    try:
        cmd = [
            "xvfb-run",
            "-a",  # auto select display
            FLASHPRO_EXPRESS,
            f"script:{tcl_path}",
            "console_mode:brief",
            f"logfile:{log_path}"
        ]

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        for line in iter(process.stdout.readline, ""):
            yield {"type": "log", "line": line}

        process.stdout.close()
        process.wait()

        yield {"type": "log", "line": "\n===== Finished =====\n"}

    except Exception:
        yield {"type": "log", "line": traceback.format_exc()}


# ==============================
# Queue
# ==============================

def enqueue_flashpro_job(hw_server, actions=None, project_file=None):
    """
    Enqueue a programming job and stream results.
    """
    result_queue = queue.Queue()
    job_queue.put((hw_server, actions, project_file, result_queue))

    while True:
        item = result_queue.get()
        if item is None:
            break
        yield item


def job_worker():
    while True:
        hw_server, actions, project_file, result_queue = job_queue.get()

        try:
            for item in stream_flashpro(
                hw_server,
                actions,
                project_file
            ):
                result_queue.put(item)

        except Exception as e:
            result_queue.put({"type": "log", "line": str(e)})

        finally:
            result_queue.put(None)
            job_queue.task_done()


threading.Thread(target=job_worker, daemon=True).start()
