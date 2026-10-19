puts "=== Listing KU Digilent cables via Vivado ==="

set hw_server_url "localhost:3121"
if {[info exists ::env(KU_HW_SERVER_URL)] && [string trim $::env(KU_HW_SERVER_URL)] ne ""} {
    set hw_server_url [string trim $::env(KU_HW_SERVER_URL)]
}

puts "=== hw_server: $hw_server_url ==="

if {[catch {open_hw_manager -quiet} err]} {
    puts "ERROR: Failed to open hardware manager: $err"
    exit 1
}

if {[catch {connect_hw_server -url $hw_server_url -allow_non_jtag -quiet} err]} {
    puts "ERROR: Failed to connect to hw_server $hw_server_url: $err"
    exit 1
}

set targets [get_hw_targets]
puts "=== target_count: [llength $targets] ==="

foreach t $targets {
    puts "CABLE_TARGET: $t"
    if {[catch {set freq [get_property PARAM.FREQUENCY $t]} err]} {
        puts "CABLE_FREQ: $t NA"
    } else {
        puts "CABLE_FREQ: $t $freq"
    }
}

puts "=== Cable listing completed ==="
