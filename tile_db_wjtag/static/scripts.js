// Global variables
let hwConfig = null;      // Your existing config
let hwDetected = null;    // Detected hardware (Digilent + FlashPro)

async function loadHwConfig() {
    try {
        // -------------------------------
        // Load hwConfig from server
        // -------------------------------
        const configResponse = await fetch("/api/hw_config");
        hwConfig = await configResponse.json();
        console.log("Loaded HW config:", hwConfig);

        // -------------------------------
        // Load detected hardware
        // -------------------------------
        const detectedResponse = await fetch("/api/detect_programmers");
        hwDetected = await detectedResponse.json();
        console.log("Detected hardware from server:", hwDetected);

        // -------------------------------
        // Now initialize the UI
        // -------------------------------
        initializeUI();

    } catch (error) {
        console.error("Failed to load hardware or detected devices:", error);
    }
}

async function updateDetectedHW() {
    if (!hwConfig) return;

    try {
        const response = await fetch("/api/detect_programmers");
        hwDetected = await response.json();

        // -----------------------
        // KU
        // -----------------------
        const kuABox = document.getElementById("ku_side_a_box");
        const kuBBox = document.getElementById("ku_side_b_box");

        const detectedKU = hwDetected?.digilent?.map(dev => dev.serial) || [];
        

        if (!detectedKU.includes(hwConfig.ku.sides.a.serial)) {
            kuABox.classList.add("blink-red");
        } else {
            kuABox.classList.remove("blink-red");
        }

        if (!detectedKU.includes(hwConfig.ku.sides.b.serial)) {
            kuBBox.classList.add("blink-red");
        } else {
            kuBBox.classList.remove("blink-red");
        }

        // -----------------------
        // ProASIC
        // -----------------------
        const proABox = document.getElementById("proasic_side_a_box");
        const proBBox = document.getElementById("proasic_side_b_box");

        const detectedPro = hwDetected?.flashpro?.map(dev => dev.serial) || [];

        if (!detectedPro.includes(hwConfig.proasic.sides.a.programmer)) {
            proABox.classList.add("blink-red");
        } else {
            proABox.classList.remove("blink-red");
        }

        if (!detectedPro.includes(hwConfig.proasic.sides.b.programmer)) {
            proBBox.classList.add("blink-red");
        } else {
            proBBox.classList.remove("blink-red");
        }

    } catch (err) {
        console.error("Failed to detect hardware:", err);
    }
}



function initializeUI() {
    if (!hwConfig) {
        console.error("HW config not loaded.");
        return;
    }

    console.log("Initializing UI with config:", hwConfig);

    // ----------------------------------
    // Build dynamic maps (VERY IMPORTANT)
    // ----------------------------------

    // KU serial -> side map
    window.kuSerialToSide = {};
    Object.entries(hwConfig.ku.sides).forEach(([side, data]) => {
        kuSerialToSide[data.serial] = side;
    });

    // ProASIC programmer -> side map
    window.proasicProgToSide = {};
    Object.entries(hwConfig.proasic.sides).forEach(([side, data]) => {
        proasicProgToSide[data.programmer] = side;
    });

    console.log("KU serial map:", kuSerialToSide);
    console.log("ProASIC programmer map:", proasicProgToSide);

    // ----------------------------------
    // Prebuild reusable regex strings
    // ----------------------------------

    const kuSerials = Object.values(hwConfig.ku.sides)
        .map(s => s.serial)
        .join("|");

    window.kuDnaRegex = new RegExp(
        `\\((${kuSerials})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`,
        "i"
    );

    window.kuResultRegex = new RegExp(
        `\\((${kuSerials})\\)\\s+Tile Operation\\s+(Success|Failure)!`,
        "i"
    );

    console.log("KU regex ready.");

    // ----------------------------------
    // Optional: Show config info in UI
    // ----------------------------------

    const kuInfo = document.getElementById("ku_config_info");
    if (kuInfo) {
        kuInfo.innerText = Object.entries(hwConfig.ku.sides)
            .map(([side, d]) => `Side ${side.toUpperCase()}: ${d.serial}`)
            .join(" | ");
    }

    const proasicInfo = document.getElementById("proasic_config_info");
    if (proasicInfo) {
        proasicInfo.innerText = Object.entries(hwConfig.proasic.sides)
            .map(([side, d]) => `Side ${side.toUpperCase()}: ${d.programmer}`)
            .join(" | ");
    }


    // ------------------
    // KU Boxes
    // ------------------
    const kuABox = document.getElementById("ku_side_a_box");
    const kuBBox = document.getElementById("ku_side_b_box");

    kuABox.innerText = `A: ${hwConfig.ku.sides.a.serial}`;
    kuBBox.innerText = `B: ${hwConfig.ku.sides.b.serial}`;

    // hwDetected.digilent contains the connected KU serials
    const detectedKU = hwDetected.digilent.map(dev => dev.serial);    

    if (!detectedKU.includes(hwConfig.ku.sides.a.serial)) {
        kuABox.classList.add("blink-red");
    } else {
        kuABox.classList.remove("blink-red");
    }

    if (!detectedKU.includes(hwConfig.ku.sides.b.serial)) {
        kuBBox.classList.add("blink-red");
    } else {
        kuBBox.classList.remove("blink-red");
    }
    // ------------------
    // ProASIC Boxes
    // ------------------
    const proABox = document.getElementById("proasic_side_a_box");
    const proBBox = document.getElementById("proasic_side_b_box");

    proABox.innerText = `A: ${hwConfig.proasic.sides.a.programmer}`;
    proBBox.innerText = `B: ${hwConfig.proasic.sides.b.programmer}`;

    // hwDetected.flashpro contains the connected ProASIC programmers
    const detectedPro = hwDetected.flashpro.map(dev => dev.serial);

    if (!detectedPro.includes(hwConfig.proasic.sides.a.programmer)) {
        proABox.classList.add("blink-red");
    }
    if (!detectedPro.includes(hwConfig.proasic.sides.b.programmer)) {
        proBBox.classList.add("blink-red");
    }


    console.log("UI initialized successfully.");
}



document.addEventListener("DOMContentLoaded", loadHwConfig);


// ----------------------------
// Runtime state
// ----------------------------
let activeEventSources = {
    ku: null,
    proasic: null
};

let activeTimers = {}; // keep track of running timers


function checkLedStatus(type) {
    const sides = ["a", "b"];
    let failed = false;

    sides.forEach(side => {
        let statusId;
        if (type === "ku_program") statusId = `ku_program_side_${side}_status`;
        else if (type === "ku_flash_program") statusId = `ku_flash_side_${side}_status`;
        else if (type === "ku_verify") statusId = `ku_verify_side_${side}_status`;
        else return;

        const span = document.getElementById(statusId);
        if (span && span.innerText === "FAILED!") failed = true;
    });

    return failed ? "failure" : "success";
}

// ----------------------------
// Update DB info and check equality
// ----------------------------
function updateDbBoxes() {
    const sideA = {
        serial: document.getElementById("ku_side_a_serial").innerText,
        batch: document.getElementById("ku_side_a_batch").innerText
    };
    const sideB = {
        serial: document.getElementById("ku_side_b_serial").innerText,
        batch: document.getElementById("ku_side_b_batch").innerText
    };

    const equal = sideA.serial === sideB.serial && sideA.batch === sideB.batch;

    ["db_side_a_box", "db_side_b_box"].forEach(id => {
        const box = document.getElementById(id);
        if (!box) return;
        box.classList.remove("blink-red", "green-text");
        if (!equal) {
            box.classList.add("blink-red");
        } else {
            box.classList.add("green-text");
        }
    });
}

async function startAction(action, type) {
    // Update HW status before starting
    await updateDetectedHW();

    let group = null;

    if (action.includes("ku")) {
        group = "ku";
    } else if (action.includes("proasic")) {
        group = "proasic";
    }

    if (!group) {
        console.warn("Unknown action group:", action);
        return;
    }

    if (activeEventSources[group]) {
        alert(group.toUpperCase() + " operation already running.");
        return;
    }
    clearConsole(group);


    const led = document.getElementById("led_" + action);
    resetLED(led);
    led.classList.add("running");

    const timerSpan = document.getElementById("timer_" + action);

    // Reset timer
    if (timerSpan) {
        timerSpan.innerText = "00:00";
        if (activeTimers[action]) {
            clearInterval(activeTimers[action]);
        }
    }

    let startTime = Date.now();

    // Update timer every second
    if (timerSpan) {
        activeTimers[action] = setInterval(() => {
            let elapsed = Math.floor((Date.now() - startTime)/1000);
            let minutes = String(Math.floor(elapsed/60)).padStart(2,"0");
            let seconds = String(elapsed % 60).padStart(2,"0");
            timerSpan.innerText = `${minutes}:${seconds}`;
        }, 1000);
    }

    // Clear fields for specific actions
    if (type === "proasic_program") {
        ["program_side_a_status","program_side_a_id","program_side_b_status","program_side_b_id"].forEach(id => document.getElementById(id).innerText = "---");
    }
    if (type === "proasic_verify") {
        ["verify_side_a_status","verify_side_a_id","verify_side_b_status","verify_side_b_id"].forEach(id => document.getElementById(id).innerText = "---");
    }


    activeEventSources[group] = new EventSource("/run/" + action);
    const eventSource = activeEventSources[group];

    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);

        // ------------------------
        // Console output
        // ------------------------
        if (data.line) {
            appendToConsole(data.line, group);

            if (type === "proasic_program") {
                parseProgramLine(data.line);
            } else if (type === "proasic_verify") {
                parseVerifyLine(data.line);
            } else if (type === "proasic") {
                parseIDs(data.line, type);
            } else if (type === "ku") {
                parseKuID(data.line);
            } else if (type === "ku_verify") {
                parseKuVerify(data.line);
            } else if (type === "ku_program") {
                parseKuProgram(data.line);
            } else if (type === "ku_flash_program") {
                parseKuFlashProgram(data.line);
            }
        }

        if (data.source === "ku") {
            if (data.db_status === "registered") {
                // Update DB info in the UI
                const side = data.side.toLowerCase(); // 'a' or 'b'
                document.getElementById(`ku_side_${side}_serial`).innerText = data.serial_no;
                document.getElementById(`ku_side_${side}_batch`).innerText = data.batch_id;

                // Compare both sides
                updateDbBoxes();
            } 
            // else if (data.db_status === "unregistered") {
            //     const map = {
            //         [hwConfig.ku.sides.a.serial]: "a",
            //         [hwConfig.ku.sides.b.serial]: "b"
            //     };
            //     const side = map[sideKey] || sideKey;
            //     console.log(side);
            //     document.getElementById(`ku_side_${side}_serial`).innerText = "Not in DBbase";
            //     document.getElementById(`ku_side_${side}_batch`).innerText = "Not in DBbase";
            //     updateDbBoxes();
            // }

        }

        // ------------------------
        // Handle per-side status from run_process
        // ------------------------
        if (data.side_status) {
            for (const [sideKey, result] of Object.entries(data.side_status)) {
                let statusText = result === "success" ? "Passed" : "FAILED!";
                let className = result === "success" ? "passed" : "failed";

                // ------------------------
                // ProASIC
                // ------------------------
                if (data.source === "proasic") {
                    const side = sideKey === "A" ? "a" : "b";
                    const statusId = type.includes("program") ? `program_side_${side}_status` : `verify_side_${side}_status`;
                    const idId = type.includes("program") ? `program_side_${side}_id` : `verify_side_${side}_id`;

                    const statusSpan = document.getElementById(statusId);
                    const idSpan = document.getElementById(idId);

                    if (statusSpan) {
                        statusSpan.innerText = statusText;
                        statusSpan.className = className;
                    }

                    if (idSpan && document.getElementById(`proasic_side_${side}`)) {
                        idSpan.innerText = document.getElementById(`proasic_side_${side}`).innerText;
                    }
                }

                // ------------------------
                // Xilinx KU
                // ------------------------
                if (data.source === "ku") {
                    const map = {
                        [hwConfig.ku.sides.a.serial]: "a",
                        [hwConfig.ku.sides.b.serial]: "b"
                    };
                    const side = map[sideKey] || sideKey;

                    const statusId = type.includes("program") ? `ku_program_side_${side}_status` :
                                    type.includes("flash")   ? `ku_flash_side_${side}_status` :
                                    `ku_verify_side_${side}_status`;
                    const dnaId = `ku_side_${side}_dna`;

                    const statusSpan = document.getElementById(statusId);
                    const dnaSpan = document.getElementById(dnaId);
                    const idSpan = statusId.replace("_status","_id");

                    if (statusSpan) {
                        statusSpan.innerText = statusText;
                        statusSpan.className = className;
                    }

                    if (idSpan && dnaSpan) {
                        document.getElementById(idSpan).innerText = dnaSpan.innerText;
                    }
                }
            }
        }

        // Final status / LED
        if (data.status) {
            const ledStatus = checkLedStatus(type);
            finishLED(led, ledStatus);

            eventSource.close();
            activeEventSources[group] = null;

            if (activeTimers[action]) {
                clearInterval(activeTimers[action]);
                delete activeTimers[action];
            }
        }
    };

    eventSource.onerror = function() {
        finishLED(led, "failure");
        eventSource.close();
        activeEventSources[group] = null;

        if (activeTimers[action]) {
            clearInterval(activeTimers[action]);
            delete activeTimers[action];
        }
    };
}


// ----------------------------
// Console helper
// ----------------------------
function appendToConsole(text, group) {
    const consoleId = group === "ku" ? "ku_console" : "proasic_console";
    const consoleDiv = document.getElementById(consoleId);
    if (!consoleDiv) return;

    const line = document.createElement("div");
    line.textContent = text;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}


// ----------------------------
// Parsing functions
// ----------------------------
function parseIDs(line, type) {

    // XILINX
    if (type === "ku") {
        if (line.includes("IDCODE") || line.includes("Device ID")) {
            const ku = document.getElementById("ku_ids");
            if (ku) ku.innerHTML = line.trim();
        }
    }

    // PROASIC
    if (type === "proasic") {
        const regex = /programmer\s+'([^']+)'.*EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)/;
        const match = line.match(regex);

        if (match) {
            const programmer = match[1];
            const fsn = match[2];

            // Side A
            if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.a.programmer.trim().toUpperCase())) {
                const a = document.getElementById("proasic_side_a");
                if (a) a.innerText = fsn;
            }

            // Side B
            if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.b.programmer.trim().toUpperCase())) {
                const b = document.getElementById("proasic_side_b");
                if (b) b.innerText = fsn;  
            }
        }
    }
}



// ----------------------------
// ProASIC: parse verify lines
// ----------------------------
function parseVerifyLine(line) {
    const statusRegex = /programmer\s+'([^']+)'.*VERIFY\s+(PASSED|FAILED)/i;
    const idRegex = /programmer\s+'([^']+)'.*EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)/i;
    let match;

    if ((match = line.match(statusRegex))) {
        const programmer = match[1];
        const result = match[2].toUpperCase();
        const className = result === "PASSED" ? "passed" : "failed";

        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.a.programmer.trim().toUpperCase())) {
            const span = document.getElementById("verify_side_a_status");
            span.innerText = result;
            span.className = className;
        }
        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.b.programmer.trim().toUpperCase())) {
            const span = document.getElementById("verify_side_b_status");
            span.innerText = result;
            span.className = className;
        }
    }

    if ((match = line.match(idRegex))) {
        const programmer = match[1];
        const fsn = match[2];

        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.a.programmer.trim().toUpperCase())) {
            document.getElementById("verify_side_a_id").innerText = fsn;
        }
        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.b.programmer.trim().toUpperCase())) {
            document.getElementById("verify_side_b_id").innerText = fsn;
        }
    }
}


function parseProgramLine(line) {
    const statusRegex = /programmer\s+'([^']+)'.*Chain programming\s+(PASSED|FAILED)/i;
    const idRegex = /programmer\s+'([^']+)'.*EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)/i;
    let match;

    if ((match = line.match(statusRegex))) {
        const programmer = match[1];
        const result = match[2].toUpperCase();
        const statusText = result === "PASSED" ? "Programmed" : "FAILED!";
        const className = result === "PASSED" ? "passed" : "failed";

        if (programmer === hwConfig.proasic.sides.a.programmer) {
            const span = document.getElementById("program_side_a_status");
            span.innerText = statusText;
            span.className = className;
        }
        if (programmer === hwConfig.proasic.sides.b.programmer) {
            const span = document.getElementById("program_side_b_status");
            span.innerText = statusText;
            span.className = className;
        }
    }

    if ((match = line.match(idRegex))) {
        const programmer = match[1];
        const fsn = match[2];

        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.a.programmer.trim().toUpperCase())) {
            document.getElementById("program_side_a_id").innerText = fsn;
        }
        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.b.programmer.trim().toUpperCase())) {
            document.getElementById("program_side_b_id").innerText = fsn;
        }
    }
}

// ----------------------------
// KU: parse ID lines
// ----------------------------
function parseKuID(line) {
    const dnaRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const match = line.match(dnaRegex);

    if (!match) return;

    const serial = match[1];
    const dna = match[2];

    if (serial === hwConfig.ku.sides.a.serial) {
        document.getElementById("ku_side_a_dna").innerText = dna;
    }
    if (serial === hwConfig.ku.sides.b.serial) {
        document.getElementById("ku_side_b_dna").innerText = dna;
    }
}


// ----------------------------
// KU: parse verify lines
// ----------------------------
function parseKuVerify(line) {
    const dnaRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === hwConfig.ku.sides.a.serial) document.getElementById("ku_verify_side_a_id").innerText = dna;
        if (serial === hwConfig.ku.sides.b.serial) document.getElementById("ku_verify_side_b_id").innerText = dna;
    }

    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";
        updateKuVerify(serial, passed);
    }
}

function updateKuVerify(serial, passed) {
    const statusText = passed ? "Passed" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === hwConfig.ku.sides.a.serial) {
        document.getElementById("ku_verify_side_a_status").innerText = statusText;
        document.getElementById("ku_verify_side_a_status").className = className;
    }
    if (serial === hwConfig.ku.sides.b.serial) {
        document.getElementById("ku_verify_side_b_status").innerText = statusText;
        document.getElementById("ku_verify_side_b_status").className = className;
    }
}

// ----------------------------
// KU: parse program lines
// ----------------------------
function parseKuProgram(line) {
    const dnaRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === hwConfig.ku.sides.a.serial) document.getElementById("ku_program_side_a_id").innerText = dna;
        if (serial === hwConfig.ku.sides.b.serial) document.getElementById("ku_program_side_b_id").innerText = dna;
    }

    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";
        updateKuProgramStatus(serial, passed);
    }
}

function updateKuProgramStatus(serial, passed) {
    const statusText = passed ? "Programmed" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === hwConfig.ku.sides.a.serial) {
        document.getElementById("ku_program_side_a_status").innerText = statusText;
        document.getElementById("ku_program_side_a_status").className = className;
    }
    if (serial === hwConfig.ku.sides.b.serial) {
        document.getElementById("ku_program_side_b_status").innerText = statusText;
        document.getElementById("ku_program_side_b_status").className = className;
    }
}

// ----------------------------
// KU: parse flash program lines
// ----------------------------
function parseKuFlashProgram(line) {
    const dnaRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${hwConfig.ku.sides.a.serial}|${hwConfig.ku.sides.b.serial})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === hwConfig.ku.sides.a.serial) document.getElementById("ku_flash_side_a_id").innerText = dna;
        if (serial === hwConfig.ku.sides.b.serial) document.getElementById("ku_flash_side_b_id").innerText = dna;
    }

    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";
        updateKuFlashStatus(serial, passed);
    }
}

function updateKuFlashStatus(serial, passed) {
    const statusText = passed ? "Programmed" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === hwConfig.ku.sides.a.serial) {
        document.getElementById("ku_flash_side_a_status").innerText = statusText;
        document.getElementById("ku_flash_side_a_status").className = className;
    }
    if (serial === hwConfig.ku.sides.b.serial) {
        document.getElementById("ku_flash_side_b_status").innerText = statusText;
        document.getElementById("ku_flash_side_b_status").className = className;
    }
}



// ----------------------------
// LED helpers
// ----------------------------
function finishLED(led, status) {
    led.classList.remove("running");
    if (status === "success") {
        led.classList.add("green");
    } else {
        led.classList.add("red");
    }
}

function resetLED(led) {
    led.className = "led";
}

function clearConsole(group) {
    const consoleId = group === "ku" ? "ku_console" : "proasic_console";
    const consoleDiv = document.getElementById(consoleId);
    if (consoleDiv) consoleDiv.innerHTML = "";
}




document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/get_hostname'); // Update to your actual endpoint
        const data = await response.json();
        document.getElementById('hostname-value').textContent = data.hostname;
    } catch (error) {
        document.getElementById('hostname-value').textContent = "Unknown";
    }
});


// Update CPU/RAM every 5 seconds
async function updateSystemUsage() {
    try {
        const res = await fetch("/api/system_usage");
        const data = await res.json();
        const cpuSpan = document.getElementById("cpu-usage");
        const ramSpan = document.getElementById("ram-usage");

        cpuSpan.innerText = data.cpu + "%";
        ramSpan.innerText = data.ram + "%";

        // Highlight if high usage
        cpuSpan.classList.toggle("cpu-high", data.cpu > 80);
        ramSpan.classList.toggle("ram-high", data.ram > 80);

    } catch (err) {
        console.error("Failed to fetch system usage:", err);
    }
}
setInterval(updateSystemUsage, 5000);
updateSystemUsage(); // initial call

// Refresh processes
document.getElementById("refresh-processes").addEventListener("click", async () => {
    const btn = document.getElementById("refresh-processes");
    btn.disabled = true;
    btn.innerText = "Refreshing...";
    try {
        const res = await fetch("/api/refresh_processes", { method: "POST" });
        const data = await res.json();
        console.log("Killed processes:", data.killed);
        alert("Processes refreshed: " + (data.killed.length ? data.killed.join(", ") : "None"));
    } catch (err) {
        console.error(err);
        alert("Failed to refresh processes.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Refresh Processes";
    }
});

// Set hostname on load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/get_hostname');
        const data = await response.json();
        document.getElementById('hostname-value').textContent = data.hostname;
    } catch (error) {
        document.getElementById('hostname-value').textContent = "Unknown";
    }
});
