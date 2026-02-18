import os
import subprocess
import queue
import threading
import traceback
from datetime import datetime

# ==============================
# Configuration
# ==============================
BASE_DIR = r"C:\tile-wjtag\tcl_proasic"

DEFAULT_PROJECT = os.path.join(BASE_DIR, "../bin/proasic/db7_proasic.pro")
DEFAULT_PDB = os.path.join(BASE_DIR, "../bin/proasic/db7_proasic.pdb")

FP_PROJECTS_BASE = os.path.join(BASE_DIR, "fp_projects_log")
LOG_FOLDER = os.path.join(BASE_DIR, "logged")
TCL_FOLDER = os.path.join(LOG_FOLDER, "tcl")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

os.makedirs(FP_PROJECTS_BASE, exist_ok=True)
os.makedirs(LOG_FOLDER, exist_ok=True)
os.makedirs(TCL_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")


SCRIPT_NAME = "flashpro_job"

os.makedirs(LOG_FOLDER, exist_ok=True)
os.makedirs(TCL_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)



job_queue = queue.Queue()


# ==============================
# Utilities
# ==============================
def get_timestamp():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")



# ==============================
# TCL Builder
# ==============================
def build_flashpro_tcl(action, project_file, pdb_file):

    action = action.upper()

    return f"""
puts "=== {action} Operation Started ==="

open_project -project {{{project_file}}} -connect_programmers 1
set_programming_file -file {{{pdb_file}}}
set_programming_action -action {{{action}}}
run_selected_actions

puts "=== {action} Operation Finished ==="
"""


def generate_unique_fp_project_folder():
    """Generate a unique folder for FlashPro new_project command."""
    timestamp = get_timestamp()
    folder = os.path.join(FP_PROJECTS_BASE, f"job_{timestamp}")
    counter = 0
    while os.path.exists(folder):
        counter += 1
        folder = os.path.join(FP_PROJECTS_BASE, f"job_{timestamp}_{counter}")
    return folder


# ==============================
# Stream Execution
# ==============================
def stream_flashpro(hw_server,
                    action="list",
                    project_file=None,
                    pdb_file=None):

    timestamp = get_timestamp()

    log_path = os.path.join(
        LOG_FOLDER,
        f"{SCRIPT_NAME}_{action}_{timestamp}.log"
    )

    tcl_path = os.path.join(
        TCL_FOLDER,
        f"{SCRIPT_NAME}_{action}_{timestamp}.tcl"
    )

    # Defaults
    if not project_file:
        project_file = DEFAULT_PROJECT

    if not pdb_file:
        pdb_file = DEFAULT_PDB

    # LIST mode
    if action == "list":
        # Ensure unique project folder exists
        fp_project_folder = generate_unique_fp_project_folder()

        print
        tcl_script = f"""
puts "=== Listing FlashPro Programmers ==="
new_project -name {{list_prog_{timestamp}}} -location {{{fp_project_folder}}} -mode {{single}}
close_project
puts "=== Done Listing ==="
"""
    else:
        tcl_script = build_flashpro_tcl(action, project_file, pdb_file)

    with open(tcl_path, "w") as f:
        f.write(tcl_script)

    yield {"type": "log", "line": f"Using project: {project_file}\n"}
    yield {"type": "log", "line": f"Using pdb: {pdb_file}\n"}
    yield {"type": "log", "line": f"TCL: {tcl_path}\n\n"}

    try:
        flashpro_exe = r"C:\Microsemi\Libero_SoC_v11.9\Designer\bin\flashpro.exe"

        cmd = f'"{flashpro_exe}" script:{tcl_path}'

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            shell=True,
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
def enqueue_flashpro_job(hw_server,
                         action="list",
                         project_file=None,
                         pdb_file=None):

    result_queue = queue.Queue()
    job_queue.put((hw_server, action, project_file, pdb_file, result_queue))

    while True:
        item = result_queue.get()
        if item is None:
            break
        yield item


def job_worker():
    while True:
        hw_server, action, project_file, pdb_file, result_queue = job_queue.get()

        try:
            for item in stream_flashpro(
                hw_server,
                action,
                project_file,
                pdb_file
            ):
                result_queue.put(item)

        except Exception as e:
            result_queue.put({"type": "log", "line": str(e)})

        finally:
            result_queue.put(None)
            job_queue.task_done()


threading.Thread(target=job_worker, daemon=True).start()
