puts "=== Starting KU Flash Blank Check ==="

# -----------------------------
# Define programmers
# -----------------------------

package require json

source [file join [file dirname [info script]] ku_jtag_utils.tcl]

# Get and print current working directory
set current_dir [pwd]
puts "=== Execution Directory: $current_dir ==="

set json_file "resources/hw_config.json"
set hostname [info hostname]
puts "=== Execution Host: $hostname ==="

# Read and parse JSON
set fp [open $json_file r]
set file_data [read $fp]
close $fp
set data [json::json2dict $file_data]

set programmers {}
set jtag_freq_hz 0

# Check if current host exists in config
if {[dict exists $data $hostname]} {
    set jtag_freq_hz [ku_read_jtag_freq_hz $data $hostname]
    set ku_sides [dict get $data $hostname ku sides]

    # Iterate through sides (a, b, etc.)
    dict for {side info} $ku_sides {
        if {![ku_side_enabled $side]} {
            puts "=== Skipping side $side (disabled for this session) ==="
            continue
        }
        lappend programmers [ku_programmer_from_side $side $info]
    }
} else {
    puts "Error: No configuration found for host $hostname"
    exit 1
}

puts "=== KU jtag_freq_hz from hw_config: $jtag_freq_hz ==="

puts "=== Selected KU firmware ==="
foreach p $programmers {
    array set fw $p
    puts "($fw(id)) bit: $fw(bitfile)"
    puts "($fw(id)) bin: $fw(binfile)"
    puts "($fw(id)) ltx: $fw(ltxfile)"
    array unset fw
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
    puts "($id) Operation: BLANK_CHECK"
    puts "($id) =============================================="

    # Set JTAG speed (before open), then open hardware target
    ku_prepare_jtag_target $target_path $jtag_freq_hz $id
    if {[catch {open_hw_target $target_path -quiet} err]} {
        puts "($id) ERROR: Failed to open target $target_path: $err"
        set error_flag 1
        continue
    }
    ku_report_jtag_frequency $id

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

        # --- Flash memory blank check ---
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

        puts "($id) Creating HW config memory for blank check..."
        startgroup
        set hw_dev_lindex [lindex [get_hw_devices $d] 0]
        if {[catch {
            create_hw_cfgmem -hw_device $hw_dev_lindex [lindex [get_cfgmem_parts {is25lp256d-spi-x1_x2_x4}] 0]

            set_property PROGRAM.BLANK_CHECK 1 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.ERASE 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.CFG_PROGRAM 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.VERIFY 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.CHECKSUM 0 [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]

            set_property PROGRAM.ADDRESS_RANGE {entire_device} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.FILES {} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.PRM_FILE {} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
            set_property PROGRAM.UNUSED_PIN_TERMINATION {pull-none} [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]

            if {![ku_load_cfgmem_programming_bitstream $id $hw_dev_lindex]} {
                error "SPI programming bitstream load failed"
            }
            program_hw_cfgmem -hw_cfgmem [get_property PROGRAM.HW_CFGMEM $hw_dev_lindex]
        } err]} {
            puts "($id) ERROR: Flash blank check failed: $err"
            set error_flag 1
        }
        endgroup
        catch {refresh_hw_device -quiet $hw_dev_lindex}
        catch {close_hw_target $target_path -quiet}
        if {$error_flag == 0} {
            puts "($id) Target flash blank check completed."
        }
    }

    # Success/failure report
    if {$error_flag == 0} {
        puts "($id) Tile Operation Success!"
    } else {
        puts "($id) Tile Operation Failure!"
    }

    puts "($id) =============================================="
}

puts "=== All KU flash blank-check operations completed ==="
