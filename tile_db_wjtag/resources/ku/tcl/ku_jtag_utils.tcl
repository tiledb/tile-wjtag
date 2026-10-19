# Shared Digilent / hw_server JTAG helpers for KU scripts.
# PARAM.FREQUENCY must be set after connect_hw_server and before open_hw_target.
# Optional session cable overrides via env:
#   KU_CABLE_OVERRIDE_A / KU_CABLE_OVERRIDE_B
# Optional session cable enable flags via env (default enabled):
#   KU_CABLE_ENABLE_A / KU_CABLE_ENABLE_B  (0/false/no/off disables)

proc ku_read_jtag_freq_hz {data hostname} {
    if {[dict exists $data $hostname ku jtag_freq_hz]} {
        return [dict get $data $hostname ku jtag_freq_hz]
    }
    return 0
}

proc ku_side_enabled {side} {
    set env_key "KU_CABLE_ENABLE_[string toupper $side]"
    if {[info exists ::env($env_key)]} {
        set val [string trim [string tolower $::env($env_key)]]
        if {$val eq "0" || $val eq "false" || $val eq "no" || $val eq "off"} {
            return 0
        }
    }
    return 1
}

proc ku_resolve_side_serial {side info} {
    set serial [dict get $info serial]
    set env_key "KU_CABLE_OVERRIDE_[string toupper $side]"
    if {[info exists ::env($env_key)]} {
        set override [string trim $::env($env_key)]
        if {$override ne ""} {
            puts "=== Cable override side $side: $serial -> $override ==="
            return $override
        }
    }
    return $serial
}

# Safe dict get — empty / missing firmware paths are valid for bin-only sets.
proc ku_dict_get {dict_value key {default ""}} {
    if {[dict exists $dict_value $key]} {
        return [dict get $dict_value $key]
    }
    return $default
}

# Build one programmer entry. Missing bit/ltx are empty strings (bin-only OK).
proc ku_programmer_from_side {side info} {
    return [list \
        hw_server [dict get $info hw_server] \
        target    [dict get $info target] \
        id        [ku_resolve_side_serial $side $info] \
        device    [dict get $info device] \
        bitfile   [string trim [ku_dict_get $info bitfile]] \
        binfile   [string trim [ku_dict_get $info binfile]] \
        ltxfile   [string trim [ku_dict_get $info ltxfile]] \
    ]
}

proc ku_require_existing_file {id label path} {
    set path [string trim $path]
    if {$path eq ""} {
        puts "($id) ERROR: No $label configured for this firmware set (bin-only / incomplete set)."
        return 0
    }
    if {![file exists $path]} {
        puts "($id) ERROR: $label not found: $path"
        return 0
    }
    return 1
}

# Load Vivado SPI-flash helper bitstream into the FPGA (not the user .bit).
# IMPORTANT: do NOT refresh_hw_device here — a refresh between program_hw_devices
# and program_hw_cfgmem commonly causes Labtools 27-3347 "node is not active".
proc ku_load_cfgmem_programming_bitstream {id hw_dev} {
    set cfgmem_bit [get_property PROGRAM.HW_CFGMEM_BITFILE $hw_dev]
    if {$cfgmem_bit eq ""} {
        puts "($id) ERROR: PROGRAM.HW_CFGMEM_BITFILE is empty after create_hw_cfgmem"
        return 0
    }
    puts "($id) Loading SPI programming bitstream: $cfgmem_bit"
    if {[catch {
        create_hw_bitstream -hw_device $hw_dev $cfgmem_bit
        program_hw_devices $hw_dev
    } err]} {
        puts "($id) ERROR: Failed to load SPI programming bitstream: $err"
        return 0
    }
    return 1
}

proc ku_prepare_jtag_target {target_path jtag_freq_hz id} {
    if {[catch {current_hw_target [get_hw_targets $target_path]} err]} {
        puts "($id) WARNING: could not select target $target_path: $err"
        return
    }

    if {$jtag_freq_hz ne "" && $jtag_freq_hz > 0} {
        puts "($id) Requested JTAG PARAM.FREQUENCY = $jtag_freq_hz Hz"
        if {[catch {set_property PARAM.FREQUENCY $jtag_freq_hz [current_hw_target]} err]} {
            puts "($id) WARNING: could not set JTAG frequency: $err"
        }
    } else {
        puts "($id) No jtag_freq_hz in hw_config — using cable/default frequency"
    }

    if {[catch {set cur [get_property PARAM.FREQUENCY [current_hw_target]]} err]} {
        puts "($id) WARNING: could not read JTAG frequency before open: $err"
    } else {
        puts "($id) JTAG frequency before open_hw_target: $cur Hz"
    }
}

proc ku_report_jtag_frequency {id} {
    if {[catch {set cur [get_property PARAM.FREQUENCY [current_hw_target]]} err]} {
        puts "($id) WARNING: could not read JTAG frequency after open: $err"
        return
    }
    puts "($id) Active JTAG frequency: $cur Hz"
}
