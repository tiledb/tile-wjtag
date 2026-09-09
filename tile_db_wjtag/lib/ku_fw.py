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


def set_exists(bin_dir, set_name):
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
        if set(KU_FW_EXTENSIONS).issubset(exts)
    ]
    return sorted(sets, key=str.lower)


def current_set_name(hw_config):
    try:
        bitfile = hw_config["ku"]["sides"]["a"]["bitfile"]
    except (KeyError, TypeError):
        return None
    return set_name_from_path(bitfile) or None


def validate_upload_files(files):
    """
    files: iterable of (filename, storage) pairs.
    Returns (stem, {ext: storage}) or (None, error).
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

    missing = [ext for ext in KU_FW_EXTENSIONS if ext not in by_ext]
    if missing:
        return None, f"missing required files: {', '.join('.' + e for e in missing)}"
    if len(stems) != 1:
        return None, "all three files must share the same base name"

    return next(iter(stems)), by_ext


def save_firmware_set(bin_dir, stem, tag, files_by_ext):
    set_name = f"{stem}_{tag}"
    if set_exists(bin_dir, set_name):
        return None, f"firmware set already exists: {set_name}"

    os.makedirs(bin_dir, exist_ok=True)
    saved = []
    try:
        for ext in KU_FW_EXTENSIONS:
            dest = os.path.join(bin_dir, f"{set_name}.{ext}")
            files_by_ext[ext].save(dest)
            saved.append(dest)
    except Exception as exc:
        for path in saved:
            try:
                os.remove(path)
            except OSError:
                pass
        return None, str(exc)

    return set_name, None


def build_firmware_zip(bin_dir, set_name):
    if not set_exists(bin_dir, set_name):
        return None, f"firmware set not found: {set_name}"

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for ext, path in paths_for_set(bin_dir, set_name).items():
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

    for side in ("a", "b"):
        sides[side]["bitfile"] = paths["bit"]
        sides[side]["binfile"] = paths["bin"]
        sides[side]["ltxfile"] = paths["ltx"]
    return True, None


def persist_hw_configs(path, all_configs):
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w") as handle:
        json.dump(all_configs, handle, indent=2)
        handle.write("\n")
    os.replace(tmp_path, path)
