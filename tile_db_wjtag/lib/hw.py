import subprocess
import re

DIGILENT_PIDS = {"6010", "6014"}  # FT2232, FT232H
DIGILENT_VID = "0403"

FLASHRO_VID = "1514"
FLASHRO_PID = "2008"


def _lsusb():
    return subprocess.check_output(["lsusb"], universal_newlines=True)


def _lsusb_verbose(bus, dev):
    return subprocess.check_output(
        ["lsusb", "-v", "-s", f"{bus}:{dev}"],
        stderr=subprocess.DEVNULL,
        universal_newlines=True
    )


def detect_digilent_programmers():
    devs = []

    for line in _lsusb().splitlines():
        if f"ID {DIGILENT_VID}:" not in line:
            continue

        m = re.search(r"ID 0403:(\w+)", line)
        if not m:
            continue

        pid = m.group(1).lower()
        if pid not in DIGILENT_PIDS:
            continue

        bm = re.search(r"Bus (\d+) Device (\d+)", line)
        if not bm:
            continue

        bus, dev = bm.groups()

        try:
            v = _lsusb_verbose(bus, dev)
        except:
            continue

        sm = re.search(r"iSerial\s+\d+\s+(\S+)", v)
        if sm:
            devs.append({
                "type": "digilent",
                "vid": DIGILENT_VID,
                "pid": pid,
                "bus": bus,
                "device": dev,
                "serial": sm.group(1)
            })

    return devs


def detect_flashpro_programmers():
    devs = []

    for line in _lsusb().splitlines():
        if f"ID {FLASHRO_VID}:{FLASHRO_PID}" not in line:
            continue

        bm = re.search(r"Bus (\d+) Device (\d+)", line)
        if not bm:
            continue

        bus, dev = bm.groups()

        try:
            v = _lsusb_verbose(bus, dev)
        except:
            continue

        sm = re.search(r"iSerial\s+\d+\s+(\S+)", v)
        if sm:
            devs.append({
                "type": "flashpro",
                "vid": FLASHRO_VID,
                "pid": FLASHRO_PID,
                "bus": bus,
                "device": dev,
                "serial": sm.group(1)
            })

    return devs
