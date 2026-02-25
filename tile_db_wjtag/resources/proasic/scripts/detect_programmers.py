import subprocess
import re

FLASHRO_PID = "2008"
FLASHRO_VID = "1514"

def get_flashpro_programmer_ids():
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
        if f"ID {FLASHRO_VID}:{FLASHRO_PID}" not in line:
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

        # Extract serial number (this is the FlashPro ID)
        sm = re.search(r"iSerial\s+\d+\s+(\S+)", v)
        if sm:
            devs.append({
                "bus": bus,
                "device": dev,
                "serial": sm.group(1)
            })

    return devs


if __name__ == "__main__":
    devs = get_flashpro_programmer_ids()

    if not devs:
        print("No FlashPro programmers found.")
    else:
        for i, d in enumerate(devs):
            print(f"FlashPro Programmer {i}:")
            print(f"  USB Path  : {d['bus']}:{d['device']}")
            print(f"  Serial ID : {d['serial']}")
