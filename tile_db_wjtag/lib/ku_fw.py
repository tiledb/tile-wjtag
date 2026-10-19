import json
import os
import re
import zipfile
from io import BytesIO

KU_FW_EXTENSIONS = ("bit", "bin", "ltx")
_TAG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def ku_bin_dir(resources_folder):
    return os.path.join(resources_folder, "ku", "bin")


def sanitize_tag(tag):
    text = (tag or "").strip()
    if not _TAG_RE.match(text):
        return None
    return text


def set_name_from_path(path):
    return os.path.splitext(os.path.basename(path or ""))[0]


def paths_for_set(bin_dir, set_name):
    return {
        ext: os.path.join(bin_dir, f"{set_name}.{ext}")
        for ext in KU_FW_EXTENSIONS
    }


def existing_exts_for_set(bin_dir, set_name):
    paths = paths_for_set(bin_dir, set_name)
    return [ext for ext, path in paths.items() if os.path.isfile(path)]


def set_exists(bin_dir, set_name):
    """A firmware set exists when at least the .bin file is present."""
    return os.path.isfile(paths_for_set(bin_dir, set_name)["bin"])


def is_complete_set(bin_dir, set_name):
    paths = paths_for_set(bin_dir, set_name)
    return all(os.path.isfile(path) for path in paths.values())


def list_firmware_sets(bin_dir):
    if not os.path.isdir(bin_dir):
        return []

    by_stem = {}
    for name in os.listdir(bin_dir):
        path = os.path.join(bin_dir, name)
        if not os.path.isfile(path):
            continue
        stem, ext = os.path.splitext(name)
        ext = ext.lstrip(".").lower()
        if ext not in KU_FW_EXTENSIONS:
            continue
        by_stem.setdefault(stem, set()).add(ext)

    sets = [
        stem
        for stem, exts in by_stem.items()
        if "bin" in exts
    ]
    return sorted(sets, key=str.lower)


def list_firmware_details(bin_dir):
    details = {}
    for set_name in list_firmware_sets(bin_dir):
        exts = existing_exts_for_set(bin_dir, set_name)
        details[set_name] = {
            "exts": exts,
            "complete": set(KU_FW_EXTENSIONS).issubset(exts),
        }
    return details


def current_set_name(hw_config):
    try:
        binfile = hw_config["ku"]["sides"]["a"]["binfile"]
    except (KeyError, TypeError):
        binfile = None
    name = set_name_from_path(binfile) if binfile else None
    if name:
        return name
    try:
        bitfile = hw_config["ku"]["sides"]["a"]["bitfile"]
    except (KeyError, TypeError):
        return None
    return set_name_from_path(bitfile) or None


def validate_upload_files(files, allow_bin_only=False):
    """
    files: iterable of (filename, storage) pairs.
    Returns (stem, {ext: storage}) or (None, error).

    Accepted layouts:
      - full set: .bit + .bin + .ltx (same base name)
      - bin-only: .bin alone (requires allow_bin_only=True)
    """
    by_ext = {}
    stems = set()

    for filename, storage in files:
        if not filename:
            continue
        stem, ext = os.path.splitext(os.path.basename(filename))
        ext = ext.lstrip(".").lower()
        if ext not in KU_FW_EXTENSIONS:
            return None, f"unsupported extension for {filename}"
        if ext in by_ext:
            return None, f"duplicate .{ext} file"
        if not stem:
            return None, "invalid file name"
        stems.add(stem)
        by_ext[ext] = storage

    if not by_ext:
        return None, "no firmware files provided"
    if len(stems) != 1:
        return None, "all files must share the same base name"

    provided = set(by_ext.keys())
    if provided == set(KU_FW_EXTENSIONS):
        return next(iter(stems)), by_ext

    if provided == {"bin"}:
        if not allow_bin_only:
            return None, "bin-only upload requires confirmation"
        return next(iter(stems)), by_ext

    return None, (
        "provide all of .bit .bin .ltx, or only a .bin file"
    )


def save_firmware_set(bin_dir, stem, tag, files_by_ext):
    set_name = f"{stem}_{tag}"
    if set_exists(bin_dir, set_name):
        return None, f"firmware set already exists: {set_name}"

    os.makedirs(bin_dir, exist_ok=True)
    saved = []
    try:
        for ext, storage in files_by_ext.items():
            dest = os.path.join(bin_dir, f"{set_name}.{ext}")
            storage.save(dest)
            saved.append(dest)
    except Exception as exc:
        for path in saved:
            try:
                os.remove(path)
            except OSError:
                pass
        return None, str(exc)

    return set_name, None


def delete_firmware_set(bin_dir, set_name):
    if not set_name or "/" in set_name or "\\" in set_name or set_name in (".", ".."):
        return False, "invalid firmware set name"
    if not set_exists(bin_dir, set_name):
        return False, f"firmware set not found: {set_name}"

    removed = []
    errors = []
    for path in paths_for_set(bin_dir, set_name).values():
        if not os.path.isfile(path):
            continue
        try:
            os.remove(path)
            removed.append(path)
        except OSError as exc:
            errors.append(str(exc))

    if errors:
        return False, f"failed to delete some files: {'; '.join(errors)}"
    if not removed:
        return False, f"firmware set not found: {set_name}"
    return True, None


def build_firmware_zip(bin_dir, set_name):
    if not set_exists(bin_dir, set_name):
        return None, f"firmware set not found: {set_name}"

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for ext, path in paths_for_set(bin_dir, set_name).items():
            if os.path.isfile(path):
                archive.write(path, arcname=f"{set_name}.{ext}")
    buffer.seek(0)
    return buffer, None


def apply_firmware_set(hw_config, bin_dir, set_name):
    if not set_exists(bin_dir, set_name):
        return False, f"firmware set not found: {set_name}"

    paths = paths_for_set(bin_dir, set_name)
    sides = hw_config.get("ku", {}).get("sides", {})
    if "a" not in sides or "b" not in sides:
        return False, "invalid KU hardware config"

    bitfile = paths["bit"] if os.path.isfile(paths["bit"]) else ""
    binfile = paths["bin"]
    ltxfile = paths["ltx"] if os.path.isfile(paths["ltx"]) else ""

    for side in ("a", "b"):
        sides[side]["bitfile"] = bitfile
        sides[side]["binfile"] = binfile
        sides[side]["ltxfile"] = ltxfile
    return True, None


def persist_hw_configs(path, all_configs):
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w") as handle:
        json.dump(all_configs, handle, indent=2)
        handle.write("\n")
    os.replace(tmp_path, path)
