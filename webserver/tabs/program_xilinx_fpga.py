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

UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
LOG_FOLDER = os.path.join(BASE_DIR, "vivado_logs")
TCL_FOLDER = os.path.join(BASE_DIR, "tcl")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(LOG_FOLDER, exist_ok=True)
os.makedirs(TCL_FOLDER, exist_ok=True)

VIVADO_SETTINGS = "/tools/Xilinx/Vivado/2022.2/settings64.sh"
SCRIPT_NAME = "program-xilinx-fpga"

job_queue = queue.Queue()

# ==============================
# Utility
# ==============================

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in {"bit", "bin"}


def get_timestamp():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

import os
# ============================== 
# TCL Generator 
# ==============================

def generate_tcl_script(job_config, timestamp):
    """
    Generates a TCL script to program FPGA targets with proper device selection.
    Uses substring matching to select the correct hardware device.
    """
    tcl_filename = f"{SCRIPT_NAME}_{timestamp}.tcl"
    tcl_path = os.path.join(TCL_FOLDER, tcl_filename)

    # Prepare hw_targets, bitfiles, and ltxfiles blocks
    hw_targets_block = ""
    bitfiles_block = ""
    ltxfiles_block = ""

    for t in job_config["targets"]:
        full_target = f"{job_config['hw_server']}/{t['target']}"
        hw_targets_block += f'    {{{full_target} {t["device"]}}}\n'
        bitfiles_block += f'    "{job_config["bit_path"]}"\n'
        if job_config.get("ltx_path") and os.path.exists(job_config["ltx_path"]):
            ltxfiles_block += f'    "{job_config["ltx_path"]}"\n'
        else:
            ltxfiles_block += '    ""\n'

    tcl_script = (
        "puts \"=== Starting FPGA Programming ===\"\n\n"
        "open_hw_manager -quiet\n"
        f"connect_hw_server -url {job_config['hw_server']} -allow_non_jtag -quiet\n\n"

        "# --- List all targets before opening any ---\n"
        "puts \"Listing all hardware targets before opening:\"\n"
        "set all_targets [get_hw_targets]\n"
        "foreach t $all_targets { puts \"  Target: $t\" }\n\n"

        "set hw_targets {\n" + hw_targets_block + "}\n\n"
        "set bitfiles {\n" + bitfiles_block + "}\n\n"
        "set ltxfiles {\n" + ltxfiles_block + "}\n\n"

        "set num_targets [llength $hw_targets]\n"
        "puts \"Found $num_targets target(s) to program\"\n\n"

        "for {set i 0} {$i < $num_targets} {incr i} {\n"
        "    set target_info [lindex $hw_targets $i]\n"
        "    set target_path [lindex $target_info 0]\n"
        "    set device_name [lindex $target_info 1]\n"
        "    set bitfile [lindex $bitfiles $i]\n"
        "    set ltxfile [lindex $ltxfiles $i]\n\n"

        "    puts \"----------------------------------------\"\n"
        "    puts \"Programming target: $target_path\"\n"
        "    puts \"Device to select: $device_name\"\n\n"

        "    if {[catch {\n"
        "        puts \"Opening hardware target...\"\n"
        "        open_hw_target $target_path -quiet\n\n"
        "        refresh_hw_server -quiet\n\n"
        "        # --- List devices for this target before opening ---\n"
        "        puts \"Listing devices for target $target_path before opening:\"\n"
        "        foreach d [get_hw_devices] { puts \"  Device: $d\" }\n\n"

        "        # --- Find device that matches device_name using substring ---\n"
        "        set hw_dev {}\n"
        "        foreach d [get_hw_devices] {\n"
        "            if {[string match \"*${device_name}*\" $d]} {\n"
        "                set hw_dev $d\n"
        "                break\n"
        "            }\n"
        "        }\n\n"
        "        if {$hw_dev eq {}} {\n"
        "            puts \"Available devices at this target after opening:\"\n"
        "            foreach d [get_hw_devices] { puts \"  $d\" }\n"
        "            error \"Device matching $device_name not found!\"\n"
        "        }\n\n"

        "        puts \"Selected device: $hw_dev\"\n"
        "        current_hw_device $hw_dev\n"
        "        refresh_hw_device -update_hw_probes false $hw_dev -quiet\n\n"

        "        if {$ltxfile != \"\" && [file exists $ltxfile]} {\n"
        "            puts \"Applying LTX file...\"\n"
        "            set_property PROBES.FILE $ltxfile $hw_dev\n"
        "            set_property FULL_PROBES.FILE $ltxfile $hw_dev\n"
        "        } else {\n"
        "            puts \"No LTX file provided. Skipping probes.\"\n"
        "        }\n\n"

        "        puts \"Programming device...\"\n"
        "        set_property PROGRAM.FILE $bitfile $hw_dev\n"
        "        program_hw_devices $hw_dev\n\n"

        "        puts \"Refreshing device...\"\n"
        "        refresh_hw_device $hw_dev -quiet\n\n"

        "        puts \"Closing hardware target...\"\n"
        "        close_hw_target $target_path -quiet\n"

        "        puts \"Target programmed successfully.\"\n"
        "    } err]} {\n"
        "        puts \"ERROR while programming target: $err\"\n"
        "        catch { close_hw_target $target_path -quiet }\n"
        "    }\n"
        "}\n\n"

        "puts \"=== All targets processed ===\"\n"
    )

    os.makedirs(TCL_FOLDER, exist_ok=True)
    with open(tcl_path, "w") as f:
        f.write(tcl_script)

    return tcl_path




# ==============================
# Vivado Streaming + Logging
# ==============================

def stream_vivado(job_config):
    timestamp = get_timestamp()
    log_filename = f"{SCRIPT_NAME}_{timestamp}.log"
    log_path = os.path.join(LOG_FOLDER, log_filename)

    try:
        tcl_path = generate_tcl_script(job_config, timestamp)

        yield f"Log file: {log_path}\n"
        yield f"TCL file: {tcl_path}\n\n"

        with open(log_path, "w") as logfile:

            def write_and_yield(text):
                logfile.write(text)
                logfile.flush()
                return text if not text.lstrip().startswith("#") else None

            if not os.path.exists(VIVADO_SETTINGS):
                yield write_and_yield(f"ERROR: Vivado settings file not found: {VIVADO_SETTINGS}\n")
                return

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
                    yield visible_line

            process.stdout.close()
            process.wait()
            yield write_and_yield("\n===== FPGA Programming Finished =====\n")

    except Exception:
        error_text = "\n===== Python Exception =====\n" + traceback.format_exc()
        yield error_text
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
            for line in stream_vivado(job_config):
                result_queue.put(line)
        except Exception as e:
            result_queue.put(f"\n===== Worker Exception =====\n{str(e)}\n")
        finally:
            result_queue.put(None)
            job_queue.task_done()


threading.Thread(target=job_worker, daemon=True).start()
