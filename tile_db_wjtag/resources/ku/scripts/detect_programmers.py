import subprocess
import re

DIGILENT_PIDS = {"6010", "6014"}

def get_digilent_programmer_ids():
    try:
        out = subprocess.check_output(
            ["lsusb"],
            universal_newlines=True
        )
    except Exception as e:
        print("lsusb failed:", e)
        return []

    devs = []

    for line in out.splitlines():
        if "0403:" not in line:
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

        bus = bm.group(1)
        dev = bm.group(2)

        try:
            v = subprocess.check_output(
                ["lsusb", "-v", "-s", f"{bus}:{dev}"],
                stderr=subprocess.DEVNULL,
                universal_newlines=True
            )
        except:
            continue

        sm = re.search(r"iSerial\s+\d+\s+(\S+)", v)
        if sm:
            devs.append({
                "bus": bus,
                "device": dev,
                "pid": pid,
                "serial": sm.group(1)
            })

    return devs


if __name__ == "__main__":
    devs = get_digilent_programmer_ids()

    if not devs:
        print("No Digilent programmers found.")
    else:
        for i, d in enumerate(devs):
            print(f"Programmer {i}:")
            print(f"  USB Path  : {d['bus']}:{d['device']}")
            print(f"  FTDI PID  : {d['pid']}")
            print(f"  Serial ID : {d['serial']}")
