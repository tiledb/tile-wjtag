open_project -project {/home/tiledb/apps/tile-wjtag/bin/proasic/db7_proasic_fw_cm.pro} -connect_programmers 1 
set_programming_action -name {db7_proasic} -action {VERIFY} 
run_selected_actions 
