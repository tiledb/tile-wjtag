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

VIVADO_SETTINGS = "/tools/Xilinx/Vivado_Lab/2022.2/settings64.sh"
SCRIPT_NAME = "program-xilinx-fpga-flash"

job_queue = queue.Queue()


# ==============================
# Utility
# ==============================

def get_timestamp():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


# ==============================
# TCL Generator
# ==============================
# ==============================
# TCL Generator
# ==============================
def generate_tcl_flash(job_config, timestamp):
    """
    Generates a TCL script to program FPGA flash memory on multiple targets,
    following a detailed template with HW_CFGMEM and bitstream programming.
    Automatically checks for and removes any existing attached memories.
    """
    bin_path = job_config["bin_file"]
    hw_server = job_config["hw_server"]
    targets = job_config.get("targets", [])
    blank_check = int(job_config.get("blank_check", False))
    erase = int(job_config.get("erase", False))
    cfg_program = int(job_config.get("cfg_program", True))
    verify = int(job_config.get("verify", True))

    tcl_filename = f"{SCRIPT_NAME}_{timestamp}.tcl"
    tcl_path = os.path.join(TCL_FOLDER, tcl_filename)

    hw_targets_block = ""
    for t in targets:
        full_target = f"{job_config['hw_server']}/{t['target']}"
        hw_targets_block += f'    {{{full_target} {t["device"]}}}\n'

    tcl_script = (
        "puts \"=== Starting FPGA Flash Memory Programming ===\"\n\n"
        "open_hw_manager -quiet\n"
        f"connect_hw_server -url {hw_server} -allow_non_jtag -quiet\n\n"
        f"set hw_targets {{\n{hw_targets_block}}}\n\n"
        "set num_targets [llength $hw_targets]\n"
        "puts \"Found $num_targets target(s) to program\"\n\n"

        "for {set i 0} {$i < $num_targets} {incr i} {\n"
        "    set target_info [lindex $hw_targets $i]\n"
        "    set target_path [lindex $target_info 0]\n"
        "    set device_name [lindex $target_info 1]\n\n"

        "    puts \"----------------------------------------\"\n"
        "    puts \"Programming flash memory on target: $target_path\"\n"
        "    puts \"Device to select: $device_name\"\n\n"

        "    if {[catch {\n"
        "        puts \"Opening hardware target...\"\n"
        "        open_hw_target $target_path -quiet\n"
        "        refresh_hw_server -quiet\n\n"

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

        "        # --- Check and remove existing attached memories ---\n"
        "        puts \"Checking existing attached memories...\"\n"
        "        set existing_cfgmem [get_property PROGRAM.HW_CFGMEM [lindex [get_hw_devices $hw_dev] 0]]\n"
        "        if {$existing_cfgmem ne {}} {\n"
        "            puts \"Found existing attached memories:\"\n"
        "            foreach m $existing_cfgmem { puts \"  $m\" }\n"
        "            puts \"Removing existing memories...\"\n"
        "            foreach m $existing_cfgmem { delete_hw_cfgmem $m }\n"
        "        }\n\n"

        "        # --- HW_CFGMEM configuration following template ---\n"
        "        puts \"Creating HW config memory...\"\n"
        "        startgroup\n"
        "        set hw_dev_lindex [lindex [get_hw_devices $hw_dev] 0]\n"
        "        create_hw_cfgmem -hw_device $hw_dev_lindex [lindex [get_cfgmem_parts {is25lp256d-spi-x1_x2_x4}] 0]\n\n"

        f"        set_property PROGRAM.BLANK_CHECK {blank_check} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        f"        set_property PROGRAM.ERASE {erase} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        f"        set_property PROGRAM.CFG_PROGRAM {cfg_program} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        f"        set_property PROGRAM.VERIFY {verify} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        "        set_property PROGRAM.CHECKSUM 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        # "        refresh_hw_device $hw_dev_lindex\n\n"

        f"        set_property PROGRAM.ADDRESS_RANGE {{use_file}} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        f"        set_property PROGRAM.FILES [list \"{bin_path}\"] [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        "        set_property PROGRAM.PRM_FILE {} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        "        set_property PROGRAM.UNUSED_PIN_TERMINATION {pull-none} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n\n"

                "        # --- Bitstream programming ---\n"
        "        create_hw_bitstream -hw_device $hw_dev_lindex [get_property PROGRAM.HW_CFGMEM_BITFILE $hw_dev_lindex]\n"
        "        program_hw_devices $hw_dev_lindex\n"
        "        refresh_hw_device $hw_dev_lindex\n\n"

        "        # --- Program the flash memory ---\n"
        "        program_hw_cfgmem -hw_cfgmem [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]\n"
        "        endgroup\n"
        "        refresh_hw_device -quiet $hw_dev_lindex\n"
        "        close_hw_target $target_path -quiet\n"
        "        puts \"Target flash programmed successfully.\"\n"
        "    } err]} {\n"
        "        puts \"ERROR while programming flash memory: $err\"\n"
        "        catch { close_hw_target $target_path -quiet }\n"
        "    }\n"
        "}\n"
        "puts \"=== All flash targets processed ===\"\n"
    )

    os.makedirs(TCL_FOLDER, exist_ok=True)
    with open(tcl_path, "w") as f:
        f.write(tcl_script)

    return tcl_path


# ==============================
# Vivado Streaming + Logging
# ==============================

def stream_vivado_flash(job_config):
    timestamp = get_timestamp()
    log_filename = f"{SCRIPT_NAME}_{timestamp}.log"
    log_path = os.path.join(LOG_FOLDER, log_filename)

    try:
        tcl_path = generate_tcl_flash(job_config, timestamp)

        yield {"type": "log", "line": f"Log file: {log_path}\n"}
        yield {"type": "log", "line": f"TCL file: {tcl_path}\n\n"}

        with open(log_path, "w") as logfile:

            def write_and_yield(text):
                logfile.write(text)
                logfile.flush()
                if not text.lstrip().startswith("#"):
                    return {"type": "log", "line": text}
                return None

            if not os.path.exists(VIVADO_SETTINGS):
                yield {
                    "type": "log",
                    "line": f"ERROR: Vivado settings file not found: {VIVADO_SETTINGS}\n"
                }
                return

            cmd = (
                "bash -c '"
                f"source {VIVADO_SETTINGS} && "
                f"vivado_lab -mode batch -nojournal -nolog -source {tcl_path}"
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
                result = write_and_yield(line)
                if result:
                    yield result

            process.stdout.close()
            process.wait()

            yield {
                "type": "log",
                "line": "\n===== Flash Memory Programming Finished =====\n"
            }

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
            for item in stream_vivado_flash(job_config):
                result_queue.put(item)
        except Exception as e:
            result_queue.put({
                "type": "log",
                "line": f"\n===== Worker Exception =====\n{str(e)}\n"
            })
        finally:
            result_queue.put(None)
            job_queue.task_done()



threading.Thread(target=job_worker, daemon=True).start()
