let activeEventSource = null;

let activeTimers = {}; // keep track of running timers

function startAction(action, type) {

    if (activeEventSource) {
        alert("Another operation is running.");
        return;
    }

    clearConsole();

    const led = document.getElementById("led_" + action);
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

    activeEventSource = new EventSource("/run/" + action);

    activeEventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.line) {
            appendToConsole(data.line, data.source);

            if (type === "proasic_program") {
                parseProgramLine(data.line);
            } else if (type === "proasic_verify") {
                parseVerifyLine(data.line);
            } else if (type === "proasic") {
                parseIDs(data.line, type);
            } else if (type === "ku") {
                parseIDs(data.line, type);
            }
        }

        if (data.status) {
            finishLED(led, data.status);
            activeEventSource.close();
            activeEventSource = null;

            // Stop timer
            if (activeTimers[action]) {
                clearInterval(activeTimers[action]);
                delete activeTimers[action];
            }

            // Auto-trigger verify after program
            // if (type === "proasic_program") {
            //     startAction("verify_proasic", "proasic_verify");
            // }
        }
    };

    activeEventSource.onerror = function() {
        finishLED(led, "failure");
        activeEventSource.close();
        activeEventSource = null;

        // Stop timer on error
        if (activeTimers[action]) {
            clearInterval(activeTimers[action]);
            delete activeTimers[action];
        }
    };
}




function appendToConsole(text, source) {
    const consoleDiv = document.getElementById("console");
    const line = document.createElement("div");
    line.className = source;
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

function clearConsole() {
    document.getElementById("console").innerHTML = "";
}
