from datetime import date, datetime

from mysql.connector import pooling

DB_CONFIG = {
    "host": "piro-atlas-lab-vserver-01.fysik.su.se",
    "user": "tiledb",
    "password": "T1le-db-word!",
    "database": "tiledb",
}

_DNA_QUERY = """
    SELECT
        serial_no,
        batch_id,
        IF(kintex_a_id = %s, 'A', 'B') AS side
    FROM daughterboard
    WHERE kintex_a_id = %s OR kintex_b_id = %s
    LIMIT 1
"""

_DAUGHTERBOARD_BY_SERIAL_QUERY = """
    SELECT *
    FROM daughterboard
    WHERE serial_no = %s
    LIMIT 1
"""

_pool = pooling.MySQLConnectionPool(
    pool_name="tile_wjtag",
    pool_size=3,
    **DB_CONFIG,
)


def decode_serial_no(serial_no):
    """Decode TTBBDDD daughterboard serial into tag, batch number, and DB index."""
    try:
        serial_int = int(serial_no)
    except (TypeError, ValueError):
        return None

    padded = str(serial_int).zfill(7)
    if len(padded) != 7 or not padded.isdigit():
        return None

    return {
        "serial_no": serial_int,
        "tag": padded[0:2],
        "batch_no": padded[2:4],
        "db_no": padded[4:7],
    }


def serialize_daughterboard(row):
    if not row:
        return None

    serialized = {}
    for key, value in row.items():
        if isinstance(value, (datetime, date)):
            serialized[key] = value.isoformat(sep=" ", timespec="seconds")
        else:
            serialized[key] = value

    decoded = decode_serial_no(serialized.get("serial_no"))
    if decoded:
        serialized["serial_decoded"] = decoded
    return serialized


def _fetch_one(query, params):
    conn = None
    cursor = None
    try:
        conn = _pool.get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query, params)
        return cursor.fetchone()
    except Exception as e:
        print("DB query failed:", e)
        return None
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()


def check_dna_in_db(dna):
    """
    Returns a dict with:
    {
        "side": "A" or "B",
        "serial_no": <daughterboard serial_no>,
        "batch_id": <daughterboard batch_id>
    }
    or None if not found.
    """
    return _fetch_one(_DNA_QUERY, (dna, dna, dna))


def get_daughterboard_by_serial(serial_no):
    """Return the full daughterboard row for a DB serial number."""
    return _fetch_one(_DAUGHTERBOARD_BY_SERIAL_QUERY, (serial_no,))


def get_component_lots_by_type():
    """Return available manufacturer lot codes grouped by component type."""
    conn = None
    cursor = None
    try:
        conn = _pool.get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT typ, manuf_date_code
            FROM component_lot
            ORDER BY typ, manuf_date_code
            """
        )
        lots_by_type = {}
        for row in cursor.fetchall():
            lots_by_type.setdefault(row["typ"], []).append(row["manuf_date_code"])
        return lots_by_type
    except Exception as e:
        print("DB query failed:", e)
        return {}
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()


def lookup_daughterboard_pair(dna_a, dna_b):
    """
    Validate that two DNAs belong to the same daughterboard on opposite sides.
    Returns a status dict with optional full daughterboard data.
    """
    if not dna_a or not dna_b:
        return {
            "status": "incomplete",
            "message": "Both side A and side B DNAs are required.",
        }

    info_a = check_dna_in_db(dna_a)
    info_b = check_dna_in_db(dna_b)

    if not info_a or not info_b:
        both_unregistered = not info_a and not info_b
        message = (
            "Neither KU DNA is registered in the database."
            if both_unregistered
            else "One or both DNAs are not registered in the database."
        )
        return {
            "status": "not_found",
            "message": message,
            "both_unregistered": both_unregistered,
            "side_a": info_a,
            "side_b": info_b,
        }

    if info_a["serial_no"] != info_b["serial_no"]:
        return {
            "status": "mismatch_serial",
            "message": (
                f"DNAs belong to different daughterboards "
                f"({info_a['serial_no']} vs {info_b['serial_no']})."
            ),
            "side_a": info_a,
            "side_b": info_b,
        }

    if info_a["side"] == info_b["side"]:
        return {
            "status": "mismatch_side",
            "message": "Both DNAs map to the same DB side.",
            "side_a": info_a,
            "side_b": info_b,
        }

    row = get_daughterboard_by_serial(info_a["serial_no"])
    if not row:
        return {
            "status": "not_found",
            "message": f"Daughterboard {info_a['serial_no']} was not found.",
        }

    return {
        "status": "matched",
        "daughterboard": serialize_daughterboard(row),
        "side_a": info_a,
        "side_b": info_b,
    }


_TEST_FLAG_FIELDS = frozenset({"e_test", "p_test"})

_LOT_FIELDS = frozenset({
    "kin_lot",
    "pro_lot",
    "gbt_lot",
    "ina_lot",
    "ltm_lot",
    "mos_lot",
    "op4_lot",
    "ok4_lot",
    "ok1_lot",
    "mem_lot",
    "sfp_lot",
})

_EDITABLE_FIELDS = frozenset({
    "db_status",
    "burn_in_start",
    "burn_in_stop",
    "burn_in_op",
    "kin_lot",
    "pro_lot",
    "gbt_lot",
    "ina_lot",
    "ltm_lot",
    "mos_lot",
    "op4_lot",
    "ok4_lot",
    "ok1_lot",
    "mem_lot",
    "sfp_lot",
    "e_test",
    "p_test",
    "a0",
    "a1",
    "b0",
    "b1",
})

_INT_FIELDS = frozenset({"db_status", "e_test", "p_test"})
_DATETIME_FIELDS = frozenset({"burn_in_start", "burn_in_stop"})


def _coerce_field_value(field, value):
    if field in _INT_FIELDS:
        if value is None or value == "":
            return None
        return int(value)

    if field in _DATETIME_FIELDS:
        if value is None or value == "":
            return None
        if isinstance(value, datetime):
            return value
        text = str(value).strip()
        if text.lower() in ("xxx", "null", "none"):
            return None
        return text

    if value is None:
        return None
    text = str(value).strip()
    if text.lower() == "xxx":
        return None
    return text


def resolve_batch_id_for_serial(serial_no):
    """Resolve assembly_batch id from existing boards sharing the same TTBB prefix."""
    decoded = decode_serial_no(serial_no)
    if not decoded:
        return None, "invalid serial number"

    prefix = decoded["serial_no"] // 1000
    row = _fetch_one(
        """
        SELECT batch_id
        FROM daughterboard
        WHERE serial_no DIV 1000 = %s
        ORDER BY serial_no DESC
        LIMIT 1
        """,
        (prefix,),
    )
    if row:
        return row["batch_id"], None

    row = _fetch_one(
        "SELECT id FROM assembly_batch ORDER BY id DESC LIMIT 1",
        (),
    )
    if row:
        return row["id"], None

    return None, "cannot determine assembly batch for this serial"


def register_daughterboard(serial_no, dna_a, dna_b, fields=None):
    """Create a new daughterboard row for unregistered KU DNAs."""
    if not serial_no:
        return False, "serial number is required", None

    try:
        serial_no = int(serial_no)
    except (TypeError, ValueError):
        return False, "invalid serial number", None

    if not decode_serial_no(serial_no):
        return False, "serial number must be a 7-digit TTBBDDD value", None

    if not dna_a or not dna_b:
        return False, "both side A and side B DNAs are required", None

    if get_daughterboard_by_serial(serial_no):
        return False, "daughterboard serial already exists", None

    for dna in (dna_a, dna_b):
        existing = check_dna_in_db(dna)
        if existing:
            return False, f"DNA {dna} is already registered to serial {existing['serial_no']}", None

    batch_id, batch_error = resolve_batch_id_for_serial(serial_no)
    if batch_error:
        return False, batch_error, None

    row = {
        "serial_no": serial_no,
        "kintex_a_id": dna_a,
        "kintex_b_id": dna_b,
        "batch_id": batch_id,
        "db_status": 0,
    }
    for lot_field in _LOT_FIELDS:
        row[lot_field] = "xxx"

    if isinstance(fields, dict):
        for field, value in fields.items():
            if field not in _EDITABLE_FIELDS:
                continue
            try:
                row[field] = _coerce_field_value(field, value)
            except (TypeError, ValueError):
                return False, f"invalid value for {field}", None

    columns = list(row.keys())
    placeholders = ", ".join(["%s"] * len(columns))
    query = (
        f"INSERT INTO daughterboard ({', '.join(columns)}) "
        f"VALUES ({placeholders})"
    )

    conn = None
    cursor = None
    try:
        conn = _pool.get_connection()
        cursor = conn.cursor()
        cursor.execute(query, [row[column] for column in columns])
        conn.commit()
    except Exception as e:
        print("DB insert failed:", e)
        if conn is not None:
            conn.rollback()
        return False, str(e), None
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()

    created = get_daughterboard_by_serial(serial_no)
    return True, None, serialize_daughterboard(created)


def update_daughterboard_test_flag(serial_no, field, value):
    """Update e_test or p_test (0 or 1) for a daughterboard serial."""
    if field not in _TEST_FLAG_FIELDS:
        return False, "invalid field"

    if value not in (0, 1):
        return False, "value must be 0 or 1"

    conn = None
    cursor = None
    try:
        conn = _pool.get_connection()
        cursor = conn.cursor()
        query = f"UPDATE daughterboard SET {field} = %s WHERE serial_no = %s"
        cursor.execute(query, (value, serial_no))
        conn.commit()
        if cursor.rowcount == 0:
            return False, "daughterboard not found"
        return True, None
    except Exception as e:
        print("DB update failed:", e)
        if conn is not None:
            conn.rollback()
        return False, str(e)
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()


def update_daughterboard_fields(serial_no, fields):
    """Update whitelisted daughterboard columns."""
    if not isinstance(fields, dict):
        return False, "fields must be an object"

    updates = {}
    for field, value in fields.items():
        if field not in _EDITABLE_FIELDS:
            continue
        try:
            updates[field] = _coerce_field_value(field, value)
        except (TypeError, ValueError):
            return False, f"invalid value for {field}"

    if not updates:
        return False, "no valid fields to update"

    conn = None
    cursor = None
    try:
        conn = _pool.get_connection()
        cursor = conn.cursor()
        set_clause = ", ".join(f"{field} = %s" for field in updates)
        query = f"UPDATE daughterboard SET {set_clause} WHERE serial_no = %s"
        params = list(updates.values()) + [serial_no]
        cursor.execute(query, params)
        conn.commit()
        if cursor.rowcount == 0:
            return False, "daughterboard not found"
        return True, None
    except Exception as e:
        print("DB update failed:", e)
        if conn is not None:
            conn.rollback()
        return False, str(e)
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            conn.close()
