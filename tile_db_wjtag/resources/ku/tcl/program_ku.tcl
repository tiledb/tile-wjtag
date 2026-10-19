puts "=== Starting FPGA Programming ==="

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

    # Set JTAG speed (before open), then open hardware target
    ku_prepare_jtag_target $full_path $jtag_freq_hz $id
    if {[catch {open_hw_target $full_path -quiet} err]} {
        puts "($id) ERROR: Failed to open target $full_path: $err"
        set error_flag 1
        continue
    }
    ku_report_jtag_frequency $id

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

        # --- Apply programming files (bitfile required; ltx optional) ---
        if {![ku_require_existing_file $id "bitfile" $prog(bitfile)]} {
            puts "($id) FPGA programming needs a .bit file. Bin-only sets are for flash ops only."
            set error_flag 1
            continue
        }

        set bitfile $prog(bitfile)
        puts "($id) Programming device with bitfile: $bitfile"
        if {[catch {
            set_property PROGRAM.FILE $bitfile $d
            program_hw_devices $d
            refresh_hw_device $d -quiet
        } err]} {
            puts "($id) ERROR: FPGA programming failed: $err"
            set error_flag 1
            continue
        }

        if {[info exists prog(ltxfile)] && $prog(ltxfile) != "" && [file exists $prog(ltxfile)]} {
            set ltxfile $prog(ltxfile)
            puts "($id) Applying LTX file: $ltxfile"
            catch {
                set_property PROBES.FILE $ltxfile $d
                set_property FULL_PROBES.FILE $ltxfile $d
            }
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
