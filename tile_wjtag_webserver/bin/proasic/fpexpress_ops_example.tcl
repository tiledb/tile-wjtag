# Microsemi Tcl Script
# flashpro
# Date: Wed Feb 18 21:12:07 2026
# Directory /home/tiledb/apps/tile-wjtag/bin/proasic
# File /home/tiledb/apps/tile-wjtag/bin/proasic/fpexpress_ops_example.tcl


open_project -project {/home/tiledb/apps/tile-wjtag/bin/proasic/db7_proasic_fw_cm.pro} -connect_programmers 1 
set_programming_action -name {db7_proasic} -action {VERIFY} 
run_selected_actions 
set_programming_action -name {db7_proasic} -action {DEVICE_INFO} 
run_selected_actions 
set_programming_action -name {db7_proasic} -action {PROGRAM} 
run_selected_actions 
