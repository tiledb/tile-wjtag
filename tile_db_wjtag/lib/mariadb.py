import mysql.connector

# ---------------------------
# MariaDB configuration
# ---------------------------
DB_CONFIG = {
    "host": "piro-atlas-lab-vserver-01.fysik.su.se",  # or your DB host
    "user": "tiledb",
    "password": "T1le-db-word!",
    "database": "tiledb"
}

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
    query = """
        SELECT
            serial_no,
            batch_id,
            CASE
                WHEN kintex_a_id = %s THEN 'A'
                WHEN kintex_b_id = %s THEN 'B'
            END AS side
        FROM daughterboard
        WHERE kintex_a_id = %s OR kintex_b_id = %s
        LIMIT 1
    """
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query, (dna, dna, dna, dna))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        return result  # dict with keys: serial_no, batch_id, side
    except Exception as e:
        print("DB query failed:", e)
        return None