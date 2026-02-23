open_project -project {/home/tiledb/apps/tile-wjtag/bin/proasic/db7_proasic_fw_cm.pro} -connect_programmers 1 
configure_flashpro5_prg \
         -vpump {ON} \
         -clk_mode {free_running_clk} \
         -programming_method {jtag} \
         -force_freq {ON} \
         -freq {10000000} 
set_programming_action -name {db7_proasic} -action {VERIFY} 
run_selected_actions 
