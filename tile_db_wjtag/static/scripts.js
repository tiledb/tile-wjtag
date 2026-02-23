let activeEventSources = {
    ku: null,
    proasic: null
};


let activeTimers = {}; // keep track of running timers

function startAction(action, type) {

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
    // if (led) {
    //     resetLED(led);
    //     led.classList.add("running");
    // } else {
    //     console.warn("LED element not found for action:", action);
    // }
    const timerSpan = document.getElementById("timer_" + action);

    resetLED(led);
    led.classList.add("running");

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

        // ------------------------
        // Handle per-side status from run_process
        // ------------------------
        if (data.side_status) {
            // Iterate over sides returned from Python
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

                    // Keep ID/FSN only if exists
                    if (idSpan && document.getElementById(`proasic_side_${side}`)) {
                        idSpan.innerText = document.getElementById(`proasic_side_${side}`).innerText;
                    }
                }

                // ------------------------
                // Xilinx KU
                // ------------------------
                if (data.source === "ku") {
                    const map = {"210249B06E36": "a", "210249B07138": "b"};
                    const side = map[sideKey] || sideKey;

                    const statusId = type.includes("program") ? `ku_program_side_${side}_status` :
                                    type.includes("flash")   ? `ku_flash_side_${side}_status` :
                                    `ku_verify_side_${side}_status`;
                    const dnaId = `ku_side_${side}_dna`;

                    const statusSpan = document.getElementById(statusId);
                    const dnaSpan = document.getElementById(dnaId);
                    const idSpan = statusId.replace("_status","_id"); // e.g., ku_program_side_a_id

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

        // ------------------------
        // Final status / LED
        // ------------------------
        if (data.status) {
            finishLED(led, data.status);
            eventSource.close();
            activeEventSources[group] = null;

            // Stop timer
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

        // Stop timer on error
        if (activeTimers[action]) {
            clearInterval(activeTimers[action]);
            delete activeTimers[action];
        }
    };
}



function appendToConsole(text, group) {
    const consoleId = group === "ku" ? "ku_console" : "proasic_console";
    const consoleDiv = document.getElementById(consoleId);
    if (!consoleDiv) return;

    const line = document.createElement("div");
    line.textContent = text;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}



function parseIDs(line, type) {

    // =========================
    // XILINX
    // =========================
    if (type === "ku") {
        if (line.includes("IDCODE") || line.includes("Device ID")) {
            const ku = document.getElementById("ku_ids");
            if (ku) ku.innerHTML = line.trim();
        }
    }

    // =========================
    // PROASIC
    // =========================
    if (type === "proasic") {

        const regex = /programmer\s+'([^']+)'.*EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)/;
        const match = line.match(regex);

        if (match) {
            const programmer = match[1];
            const fsn = match[2];

            if (programmer.includes("tile-fp5-01")) {
                const a = document.getElementById("proasic_side_a");
                if (a) a.innerText = fsn;
            }

            if (programmer.includes("tile-fp5-02")) {
                const b = document.getElementById("proasic_side_b");
                if (b) b.innerText = fsn;
            }
        }
    }
}


function parseVerifyLine(line) {
    // Example success/fail line:
    // programmer 'tile-fp5-01' : device 'db7_proasic' : Executing action VERIFY PASSED.
    // Example ID line:
    // programmer 'tile-fp5-01' : device 'db7_proasic' : EXPORT FSN[48] = 0002a4506c55

    const statusRegex = /programmer\s+'([^']+)'.*VERIFY\s+(PASSED|FAILED)/i;
    const idRegex = /programmer\s+'([^']+)'.*EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)/i;

    let match;

    if ((match = line.match(statusRegex))) {
        const programmer = match[1];
        const result = match[2].toUpperCase();

        if (programmer.includes("tile-fp5-01")) {
            const span = document.getElementById("verify_side_a_status");
            span.innerText = result;
            span.className = result === "PASSED" ? "passed" : "failed";
        }
        if (programmer.includes("tile-fp5-02")) {
            const span = document.getElementById("verify_side_b_status");
            span.innerText = result;
            span.className = result === "PASSED" ? "passed" : "failed";
        }
    }

    if ((match = line.match(idRegex))) {
        const programmer = match[1];
        const fsn = match[2];

        if (programmer.includes("tile-fp5-01")) {
            document.getElementById("verify_side_a_id").innerText = fsn;
        }
        if (programmer.includes("tile-fp5-02")) {
            document.getElementById("verify_side_b_id").innerText = fsn;
        }
    }
}

function parseProgramLine(line) {
    // Programming result example:
    // programmer 'tile-fp5-01' : Chain programming PASSED.
    // programmer 'tile-fp5-02' : Chain programming PASSED.
    // ID example:
    // programmer 'tile-fp5-01' : EXPORT FSN[48] = 0002a4506c55

    const statusRegex = /programmer\s+'([^']+)'.*Chain programming\s+(PASSED|FAILED)/i;
    const idRegex = /programmer\s+'([^']+)'.*EXPORT FSN\[48\]\s*=\s*([0-9a-fA-F]+)/i;

    let match;

    if ((match = line.match(statusRegex))) {
        const programmer = match[1];
        const result = match[2].toUpperCase();

        if (programmer.includes("tile-fp5-01")) {
            const span = document.getElementById("program_side_a_status");
            span.innerText = result === "PASSED" ? "Programmed" : "FAILED!";
            span.className = result === "PASSED" ? "passed" : "failed";
        }
        if (programmer.includes("tile-fp5-02")) {
            const span = document.getElementById("program_side_b_status");
            span.innerText = result === "PASSED" ? "Programmed" : "FAILED!";
            span.className = result === "PASSED" ? "passed" : "failed";
        }
    }

    if ((match = line.match(idRegex))) {
        const programmer = match[1];
        const fsn = match[2];

        if (programmer.includes("tile-fp5-01")) {
            document.getElementById("program_side_a_id").innerText = fsn;
        }
        if (programmer.includes("tile-fp5-02")) {
            document.getElementById("program_side_b_id").innerText = fsn;
        }
    }
}

function parseKuID(line) {

    const dnaRegex = /\((210249B06E36|210249B07138)\).*FUSE_DNA\s*=\s*([0-9A-F]+)/i;
    const match = line.match(dnaRegex);

    if (!match) return;

    const serial = match[1];
    const dna = match[2];

    if (serial === "210249B06E36") {
        document.getElementById("ku_side_a_dna").innerText = dna;
    }

    if (serial === "210249B07138") {
        document.getElementById("ku_side_b_dna").innerText = dna;
    }
}



function parseKuVerify(line) {

    const regex = /\((210249B06E36|210249B07138)\).*?(successful|failed)/i;
    const match = line.match(regex);

    if (!match) return;

    const serial = match[1];
    const passed = match[2].toLowerCase().includes("successful");

    updateKuVerify(serial, passed);
}


function updateKuVerify(serial, passed) {

    const statusText = passed ? "Passed" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === "210249B06E36") {
        document.getElementById("ku_verify_side_a_status").innerText = statusText;
        document.getElementById("ku_verify_side_a_status").className = className;
        document.getElementById("ku_verify_side_a_id").innerText =
            document.getElementById("ku_side_a_dna").innerText;

    }

    if (serial === "210249B07138") {
        document.getElementById("ku_verify_side_b_status").innerText = statusText;
        document.getElementById("ku_verify_side_b_status").className = className;
        document.getElementById("ku_verify_side_b_id").innerText =
            document.getElementById("ku_side_b_dna").innerText;

    }
}


function updateKuDNA(serial, dna) {

    if (serial === "210249B06E36") {
        document.getElementById("ku_side_a_dna").innerText = dna;
    }

    if (serial === "210249B07138") {
        document.getElementById("ku_side_b_dna").innerText = dna;
    }
}

function updateKuProgramStatus(serial, passed) {

    const statusText = passed ? "Programmed" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === "210249B06E36") {
        document.getElementById("ku_program_side_a_status").innerText = statusText;
        document.getElementById("ku_program_side_a_status").className = className;
    }

    if (serial === "210249B07138") {
        document.getElementById("ku_program_side_b_status").innerText = statusText;
        document.getElementById("ku_program_side_b_status").className = className;
    }
}


function parseKuProgram(line) {

    const dnaRegex = /\((210249B06E36|210249B07138)\).*FUSE_DNA\s*=\s*([0-9A-F]+)/i;
    const resultRegex = /\((210249B06E36|210249B07138)\)\s+Tile Operation\s+(Success|Failure)!/i;

    let match;

    // ----------------------------
    // DNA extraction (PROGRAM SECTION ONLY)
    // ----------------------------
    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];

        if (serial === "210249B06E36") {
            document.getElementById("ku_program_side_a_id").innerText = dna;
        }

        if (serial === "210249B07138") {
            document.getElementById("ku_program_side_b_id").innerText = dna;
        }
    }

    // ----------------------------
    // Success / Failure
    // ----------------------------
    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";

        updateKuProgramStatus(serial, passed);
    }
}




function parseKuFlashProgram(line) {

    const dnaRegex = /\((210249B06E36|210249B07138)\).*FUSE_DNA\s*=\s*([0-9A-F]+)/i;
    const resultRegex = /\((210249B06E36|210249B07138)\)\s+Tile Operation\s+(Success|Failure)!/i;

    let match;

    // ----------------------------
    // DNA extraction (FLASH SECTION ONLY)
    // ----------------------------
    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];

        if (serial === "210249B06E36") {
            document.getElementById("ku_flash_side_a_id").innerText = dna;
        }

        if (serial === "210249B07138") {
            document.getElementById("ku_flash_side_b_id").innerText = dna;
        }
    }

    // ----------------------------
    // Success / Failure
    // ----------------------------
    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";

        updateKuFlashStatus(serial, passed);
    }
}

function updateKuFlashStatus(serial, passed) {

    const statusText = passed ? "Programmed" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === "210249B06E36") {
        document.getElementById("ku_flash_side_a_status").innerText = statusText;
        document.getElementById("ku_flash_side_a_status").className = className;
    }

    if (serial === "210249B07138") {
        document.getElementById("ku_flash_side_b_status").innerText = statusText;
        document.getElementById("ku_flash_side_b_status").className = className;
    }
}





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
