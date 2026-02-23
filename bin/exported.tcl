# Microsemi Tcl Script
# flashpro
# Date: Sun Feb 22 20:11:08 2026
# Directory /home/tiledb/apps/tile-wjtag/bin
# File /home/tiledb/apps/tile-wjtag/bin/exported.tcl


open_project -project {/home/tiledb/apps/tile-wjtag/bin/proasic/db7_proasic_fw_cm.pro} -connect_programmers 1 
set_programming_action -name {db7_proasic} -action {VERIFY} 
run_selected_actions 
set_programming_action -name {db7_proasic} -action {DEVICE_INFO} 
run_selected_actions 
export_script -file {/home/tiledb/apps/tile-wjtag/bin/exported.tcl} -relative_path 0 
configure_flashpro5_prg \
         -vpump {ON} \
         -clk_mode {free_running_clk} \
         -programming_method {jtag} \
         -force_freq {ON} \
         -freq {30000000} 
set_programming_action -name {db7_proasic} -action {DEVICE_INFO} 
configure_flashpro5_prg \
         -vpump {ON} \
         -clk_mode {free_running_clk} \
         -programming_method {jtag} \
         -force_freq {ON} \
         -freq {10000000} 
set_programming_action -name {db7_proasic} -action {DEVICE_INFO} 
run_selected_actions 
configure_flashpro5_prg \
         -vpump {ON} \
         -clk_mode {free_running_clk} \
         -programming_method {jtag} \
         -force_freq {ON} \
         -freq {30000000} 
set_programming_action -name {db7_proasic} -action {DEVICE_INFO} 
