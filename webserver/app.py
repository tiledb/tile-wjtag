from flask import Flask, request, Response, render_template
import os
import json

# Import the two tabs
from tabs import program_xilinx_fpga
from tabs import program_xilinx_fpga_flash

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config/programming_servers.json")

# ==============================
# Load server configuration
# ==============================
def load_server_config():
    if not os.path.exists(CONFIG_PATH):
        return {"xilinx_hw_servers": [], "proasic_servers": []}

    with open(CONFIG_PATH) as f:
        return json.load(f)

def get_hw_targets_for_server(server_address):
    config = load_server_config()
    for s in config.get("xilinx_hw_servers", []):
        if s["address"] == server_address:
            return s.get("targets", [])
    return []



# ==============================
# Flask App
# ==============================
app = Flask(__name__)

@app.route('/')
def index():
    config = load_server_config()
    # Only send server names and addresses for the dropdown
    xilinx_servers = [
        {"name": s["name"], "address": s["address"]} for s in config.get("xilinx_hw_servers", [])
    ]
    proasic_servers = [
        {"name": s["name"], "address": s["address"]} for s in config.get("proasic_servers", [])
    ]
    return render_template(
        'index.html',
        xilinx_servers=xilinx_servers,
        proasic_servers=proasic_servers
    )



# ----- First tab: Program FPGA -----
@app.route('/program_fpga', methods=['POST'])
def upload_bitfile():
    bitfile = request.files['bitfile']
    ltxfile = request.files.get('ltxfile')

    bit_path = os.path.join(program_xilinx_fpga.UPLOAD_FOLDER, bitfile.filename)
    bitfile.save(bit_path)

    ltx_path = None
    if ltxfile and ltxfile.filename != "":
        ltx_path = os.path.join(program_xilinx_fpga.UPLOAD_FOLDER, ltxfile.filename)
        ltxfile.save(ltx_path)

    selected_server = request.form["hw_server"]
    targets = get_hw_targets_for_server(selected_server)

    # Build job dictionary
    job_config = {
        "bit_path": bit_path,
        "ltx_path": ltx_path,
        "hw_server": selected_server,
        "targets": targets  # list of {"server": "...", "device": "..."} dictionaries
    }

    return Response(
        program_xilinx_fpga.enqueue_job(job_config),
        mimetype='text/plain'
    )


# ----- Second tab: Program Flash Memory -----
@app.route('/program_flash', methods=['POST'])
def upload_binfile():
    binfile = request.files['binfile']
    bin_path = os.path.join(program_xilinx_fpga_flash.UPLOAD_FOLDER, binfile.filename)
    binfile.save(bin_path)

    selected_server = request.form.get("hw_server")
    targets = get_hw_targets_for_server(selected_server)

    job_config = {
        "bin_file": bin_path,
        "hw_server": selected_server,
        "targets": targets,
        "blank_check": "blank_check" in request.form,
        "erase": "erase" in request.form,
        "cfg_program": "cfg_program" in request.form,
        "verify": "verify" in request.form,
    }

    return Response(
        program_xilinx_fpga_flash.enqueue_job(job_config),
        mimetype='text/plain'
    )


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
