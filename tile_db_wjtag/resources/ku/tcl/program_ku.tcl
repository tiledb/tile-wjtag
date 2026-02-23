puts "=== Starting FPGA Programming ==="

# -----------------------------
# Define programmers
# -----------------------------
set programmers {
    { hw_server "localhost:3121" target "xilinx_tcf/Digilent/" id "210249B06E36" device "xcku035" bitfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.bit" ltxfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.ltx" }
    { hw_server "localhost:3121" target "xilinx_tcf/Digilent/" id "210249B07138" device "xcku035" bitfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.bit" ltxfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.ltx" }
}

# ==============================
# Hardware Manager Init
# ==============================

puts "=== Opening hardware manager ==="
if {[catch {open_hw_manager -quiet} err]} {
    puts "ERROR: Failed to open hardware manager: $err"
    exit 1
}

# Track connected servers to avoid reconnects
array set connected_servers {}

# ==============================
# Process programmers
# ==============================

foreach p $programmers {

    array set prog $p

    set hw_server $prog(hw_server)
    set target    "$prog(target)$prog(id)"
    set full_path "$hw_server/$target"
    set dev_filter $prog(device)
    set id $prog(id)

    # Flag to track if any error occurred for this programmer
    set error_flag 0

    # Connect hw_server only once
    if {![info exists connected_servers($hw_server)]} {
        if {[catch {connect_hw_server -url $hw_server -allow_non_jtag -quiet} err]} {
            puts "($id) ERROR: Failed to connect to hw_server $hw_server: $err"
            set error_flag 1
            continue
        }
        set connected_servers($hw_server) 1
    }

    puts "($id) =============================================="
    puts "($id) Target : $full_path"
    puts "($id) Device : $dev_filter"
    puts "($id) =============================================="

    # Open hardware target safely
    if {[catch {open_hw_target $full_path -quiet} err]} {
        puts "($id) ERROR: Failed to open target $full_path: $err"
        set error_flag 1
        continue
    }

    set devices [get_hw_devices]

    if {[llength $devices] == 0} {
        puts "($id) WARNING: No devices found on target $full_path!"
        set error_flag 1
        close_hw_target $full_path -quiet
        continue
    }

    foreach d $devices {
        # Filter by device type
        if {[catch {set part [get_property PART $d]} err]} {
            puts "($id) ERROR: Failed to get PART property for device $d: $err"
            set error_flag 1
            continue
        }

        if {![string match -nocase "*$dev_filter*" $part]} {
            continue
        }

        puts "($id) Device: $d"
        puts "($id) Part  : $part"
        puts "($id) ------------------------------------------"

        current_hw_device $d
        refresh_hw_device -update_hw_probes false $d -quiet

        # --- Read and print FUSE_DNA ---
        if {[catch {set val [get_property REGISTER.EFUSE.FUSE_DNA $d]} err]} {
            puts "($id) WARNING: Could not read REGISTER.EFUSE.FUSE_DNA for device $d: $err"
        } else {
            puts "($id) -> #PROP $d: REGISTER.EFUSE.FUSE_DNA = $val"
        }

        # --- Apply programming files (bitfile/ltxfile) ---
        if {[info exists prog(bitfile)] && $prog(bitfile) != "" && [file exists $prog(bitfile)]} {
            set bitfile $prog(bitfile)
            puts "($id) Programming device with bitfile: $bitfile"
            set_property PROGRAM.FILE $bitfile $d
            program_hw_devices $d
            refresh_hw_device $d -quiet
        } else {
            puts "($id) No bitfile provided. Skipping programming."
        }

        if {[info exists prog(ltxfile)] && $prog(ltxfile) != "" && [file exists $prog(ltxfile)]} {
            set ltxfile $prog(ltxfile)
            puts "($id) Applying LTX file: $ltxfile"
            set_property PROBES.FILE $ltxfile $d
            set_property FULL_PROBES.FILE $ltxfile $d
        } else {
            puts "($id) No LTX file provided. Skipping probes."
        }
    }

    # Close target
    catch {close_hw_target $full_path -quiet}

    # Success/failure report
    if {$error_flag == 0} {
        puts "($id) Tile Operation Success!"
    } else {
        puts "($id) Tile Operation Failure!"
    }

    puts "($id) =============================================="
}


puts "=== All FPGA programming operations completed ==="
