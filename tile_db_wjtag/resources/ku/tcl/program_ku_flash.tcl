puts "=== Starting FPGA Programming ==="

# -----------------------------
# Define programmers
# -----------------------------
set programmers {
    { hw_server "localhost:3121" target "xilinx_tcf/Digilent/" id "210249B06E36" device "xcku035" binfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.bin" ltxfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.ltx" }
    { hw_server "localhost:3121" target "xilinx_tcf/Digilent/" id "210249B07138" device "xcku035" binfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.bin" ltxfile "/home/tiledb/apps/tile-wjtag/tile_db_wjtag/resources/ku/bin/db6v5_top.ltx" }
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
    set target_path "$hw_server/$target"
    set dev_filter $prog(device)
    set id $prog(id)
    set binfile $prog(binfile)
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
    puts "($id) Target : $target_path"
    puts "($id) Device : $dev_filter"
    puts "($id) =============================================="

    # Open hardware target safely
    if {[catch {open_hw_target $target_path -quiet} err]} {
        puts "($id) ERROR: Failed to open target $target_path: $err"
        set error_flag 1
        continue
    }

    set devices [get_hw_devices]

    if {[llength $devices] == 0} {
        puts "($id) WARNING: No devices found on target $target_path!"
        set error_flag 1
        close_hw_target $target_path -quiet
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

        # --- Flash memory programming ---
        puts "($id) Checking existing attached memories..."
        
        set existing_cfgmem_objs [get_hw_cfgmems]
        puts "($id) Existing cfgmem: $existing_cfgmem_objs"

        if {[llength $existing_cfgmem_objs] > 0} {
            puts "($id) Found existing attached memories:"
            foreach m $existing_cfgmem_objs {
                puts "($id)   $m"
            }

            puts "($id) Removing existing memories..."
            foreach m $existing_cfgmem_objs {
                delete_hw_cfgmem $m
            }
        }
        

        puts "($id) Creating HW config memory..."
        startgroup
        set hw_dev_lindex [lindex [get_hw_devices $d] 0]
        create_hw_cfgmem -hw_device $hw_dev_lindex [lindex [get_cfgmem_parts {is25lp256d-spi-x1_x2_x4}] 0]

        set_property PROGRAM.BLANK_CHECK 1 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.ERASE 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.CFG_PROGRAM 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.VERIFY 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.CHECKSUM 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]

        set_property PROGRAM.ADDRESS_RANGE {use_file} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.FILES [list "$binfile"] [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.PRM_FILE {} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        set_property PROGRAM.UNUSED_PIN_TERMINATION {pull-none} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]

        create_hw_bitstream -hw_device $hw_dev_lindex [get_property PROGRAM.HW_CFGMEM_BITFILE $hw_dev_lindex]
        program_hw_devices $hw_dev_lindex
        refresh_hw_device $hw_dev_lindex

        program_hw_cfgmem -hw_cfgmem [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        endgroup
        refresh_hw_device -quiet $hw_dev_lindex
        close_hw_target $target_path -quiet
        puts "($id) Target flash programmed successfully."
    }

    # Success/failure report
    if {$error_flag == 0} {
        puts "($id) Tile Operation Success!"
    } else {
        puts "($id) Tile Operation Failure!"
    }

    puts "($id) =============================================="
}

puts "=== All FPGA programming operations completed ==="
