import subprocess
import queue
import threading
import os
import traceback
from datetime import datetime

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
LOG_FOLDER = os.path.join(BASE_DIR, "vivado_logs")
VIVADO_SETTINGS = "/tools/Xilinx/Vivado/2022.2/settings64.sh"
SCRIPT_NAME = "list-xilinx-targets"

os.makedirs(LOG_FOLDER, exist_ok=True)

job_queue = queue.Queue()


def get_timestamp():
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def stream_list_hw(hw_server):
    timestamp = get_timestamp()
    log_filename = f"{SCRIPT_NAME}_{timestamp}.log"
    log_path = os.path.join(LOG_FOLDER, log_filename)

    # Tree to store server -> targets -> devices
    tree = {"server": hw_server, "targets": []}
    current_target = None

    try:
        yield f"Log file: {log_path}\n\n"

        def write_and_yield(text):
            # Always write to log
            with open(log_path, "a") as logfile:
                logfile.write(text)
                logfile.flush()

            stripped = text.strip()
            nonlocal current_target

            # Step 1: capture new targets
            if stripped.startswith("Target:"):
                target_name = stripped.split("Target:")[1].strip()
                # create a new target in the tree
                current_target = {"name": target_name, "devices": []}
                tree["targets"].append(current_target)

            # Step 2: switch current_target if we see "Devices at target ..."
            elif stripped.startswith("Devices at target"):
                target_name = stripped.split("Devices at target")[-1].strip(": ").strip()
                # find the target in the tree
                for t in tree["targets"]:
                    if t["name"] == target_name:
                        current_target = t
                        break
                else:
                    current_target = None

            # Step 3: add devices to current_target
            elif stripped.startswith("Device:") and current_target is not None:
                device_name = stripped.split("Device:")[1].strip()
                current_target["devices"].append(device_name)

            # Only yield non-comment lines to web console
            if not text.lstrip().startswith("#"):
                return text
            return None


        if not os.path.exists(VIVADO_SETTINGS):
            yield write_and_yield(f"ERROR: Vivado settings file not found: {VIVADO_SETTINGS}\n")
            return

        # TCL script to list all targets and devices
        tcl_script = f"""
puts "=== Listing All Hardware Targets and Devices ==="
open_hw_manager -quiet
connect_hw_server -url {hw_server} -allow_non_jtag -quiet

puts "Listing all hardware targets:"
set all_targets [get_hw_targets]
foreach t $all_targets {{ puts "Target: $t" }}

foreach t $all_targets {{
    open_hw_target $t -quiet
    puts "Devices at target $t:"
    foreach d [get_hw_devices] {{ puts "Device: $d" }}
    close_hw_target $t -quiet
}}

puts "=== Done Listing ==="
"""

        tcl_path = os.path.join(LOG_FOLDER, f"{SCRIPT_NAME}_{timestamp}.tcl")
        with open(tcl_path, "w") as f:
            f.write(tcl_script)

        cmd = (
            "bash -c '"
            f"source {VIVADO_SETTINGS} && "
            f"vivado -mode batch -nojournal -nolog -source {tcl_path}"
            "'"
        )

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            shell=True,
            text=True,
            bufsize=1
        )

        for line in iter(process.stdout.readline, ''):
            visible_line = write_and_yield(line)
            if visible_line:
                # Yield a JSON-like dict to the frontend
                yield {"type": "log", "line": visible_line}

        process.stdout.close()
        process.wait()
        yield {"type": "log", "line": "\n===== Listing Finished =====\n"}
        yield {"type": "tree", "tree": tree}  # finally yield the tree

    except Exception:
        error_text = "\n===== Python Exception =====\n" + traceback.format_exc()
        yield {"type": "log", "line": error_text}
        with open(log_path, "a") as logfile:
            logfile.write(error_text)

def enqueue_hw_list(hw_server):
    result_queue = queue.Queue()
    job_queue.put((hw_server, result_queue))

    while True:
        line = result_queue.get()
        if line is None:
            break
        yield line


def job_worker():
    while True:
        hw_server, result_queue = job_queue.get()
        try:
            for line in stream_list_hw(hw_server):
                result_queue.put(line)
        except Exception as e:
            result_queue.put(f"\n===== Worker Exception =====\n{str(e)}\n")
        finally:
            result_queue.put(None)
            job_queue.task_done()


threading.Thread(target=job_worker, daemon=True).start()
