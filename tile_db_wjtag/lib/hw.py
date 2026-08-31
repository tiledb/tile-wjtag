import re
import subprocess

DIGILENT_PIDS = frozenset({"6010", "6014"})  # FT2232, FT232H
DIGILENT_VID = "0403"

FLASHRO_VID = "1514"
FLASHRO_PID = "2008"

_BUS_DEV_RE = re.compile(r"Bus (\d+) Device (\d+)")
_DIGILENT_ID_RE = re.compile(rf"ID {DIGILENT_VID}:(\w+)", re.I)
_FLASHRO_ID_RE = re.compile(rf"ID {FLASHRO_VID}:{FLASHRO_PID}", re.I)
_ISERIAL_RE = re.compile(r"iSerial\s+\d+\s+(\S+)")


def _lsusb():
    return subprocess.check_output(["lsusb"], universal_newlines=True)


def _lsusb_verbose(bus, dev):
    return subprocess.check_output(
        ["lsusb", "-v", "-s", f"{bus}:{dev}"],
        stderr=subprocess.DEVNULL,
        universal_newlines=True,
    )


def _device_serial(bus, dev):
    try:
        verbose = _lsusb_verbose(bus, dev)
    except subprocess.CalledProcessError:
        return None

    match = _ISERIAL_RE.search(verbose)
    return match.group(1) if match else None


def detect_programmers(lsusb_output=None):
    """Scan USB once and return both Digilent and FlashPro programmers."""
    digilent = []
    flashpro = []
    output = _lsusb() if lsusb_output is None else lsusb_output

    for line in output.splitlines():
        bus_dev = _BUS_DEV_RE.search(line)
        if not bus_dev:
            continue

        bus, dev = bus_dev.groups()

        dig_match = _DIGILENT_ID_RE.search(line)
        if dig_match:
            pid = dig_match.group(1).lower()
            if pid in DIGILENT_PIDS:
                serial = _device_serial(bus, dev)
                if serial:
                    digilent.append({
                        "type": "digilent",
                        "vid": DIGILENT_VID,
                        "pid": pid,
                        "bus": bus,
                        "device": dev,
                        "serial": serial,
                    })
            continue

        if _FLASHRO_ID_RE.search(line):
            serial = _device_serial(bus, dev)
            if serial:
                flashpro.append({
                    "type": "flashpro",
                    "vid": FLASHRO_VID,
                    "pid": FLASHRO_PID,
                    "bus": bus,
                    "device": dev,
                    "serial": serial,
                })

    return {"digilent": digilent, "flashpro": flashpro}


def detect_digilent_programmers():
    return detect_programmers()["digilent"]


def detect_flashpro_programmers():
    return detect_programmers()["flashpro"]
