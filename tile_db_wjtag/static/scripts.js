// Global variables
let hwConfig = null;      // Your existing config
let hwDetected = null;    // Detected hardware (Digilent + FlashPro)

async function loadHwConfig() {
    try {
        const [configResponse, detectedResponse, hostnameResponse] = await Promise.all([
            fetch("api/hw_config"),
            fetch("api/detect_programmers"),
            fetch("api/get_hostname"),
        ]);

        hwConfig = await configResponse.json();
        hwDetected = await detectedResponse.json();
        const hostnameData = await hostnameResponse.json();

        document.getElementById("hostname-value").textContent = hostnameData.hostname;
        console.log("Loaded HW config:", hwConfig);
        console.log("Detected hardware from server:", hwDetected);

        initializeUI();
    } catch (error) {
        console.error("Failed to load hardware or detected devices:", error);
        document.getElementById("hostname-value").textContent = "Unknown";
    }
}

async function updateDetectedHW() {
    if (!hwConfig) return;

    try {
        const response = await fetch("api/detect_programmers");
        hwDetected = await response.json();

        // -----------------------
        // KU
        // -----------------------
        const kuABox = document.getElementById("ku_side_a_prog");
        const kuBBox = document.getElementById("ku_side_b_prog");

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
    const kuABox = document.getElementById("ku_side_a_prog");
    const kuBBox = document.getElementById("ku_side_b_prog");

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



document.addEventListener("DOMContentLoaded", () => {
    initDaughterboardGrid();
    resetDaughterboardSection();
    loadComponentLots();
    loadHwConfig();
    initEditIdleTracking();
    initDnaChoiceModal();
});


// ----------------------------
// Runtime state
// ----------------------------
let activeEventSources = {
    ku: null,
    proasic: null
};

let activeTimers = {}; // keep track of running timers


function resetDbBoxes() {
    ["ku_side_a_serial","ku_side_a_batch","ku_side_b_serial","ku_side_b_batch"].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.innerText = "---";
    });

    ["db_side_a_box","db_side_b_box"].forEach(id=>{
        const box = document.getElementById(id);
        if (box) {
            box.classList.remove("blink-red","green-text");
        }
    });

    resetDaughterboardSection();
}

const DAUGHTERBOARD_PLACEHOLDER = "xxx";
let currentDaughterboardSerial = null;
let currentDaughterboardData = null;
let registrationMode = false;
let globalEditUnlocked = false;
let registrationExistingSerial = null;
let registrationDnaChoice = "keep";
let daughterboardBaseline = null;
let serialLookupTimer = null;
let serialLookupRequestId = 0;
let dnaChoiceResolver = null;
const EDIT_IDLE_TIMEOUT_SEC = 60;
let editIdleSecondsRemaining = EDIT_IDLE_TIMEOUT_SEC;
let editIdleInterval = null;
let editIdleListenersAttached = false;
let componentLotsByType = {};
const groupEditUnlocked = {
    info: false,
    burnin: false,
    lots: false,
    sfp: false,
};

const DAUGHTERBOARD_GROUPS = [
    {
        id: "info",
        title: "Info",
        fields: [
            { key: "serial_no", label: "Serial Number", registerEditable: true },
            { key: "kintex_a_readout", label: "Kintex A DNA", readoutId: "ku_side_a_dna" },
            { key: "kintex_b_readout", label: "Kintex B DNA", readoutId: "ku_side_b_dna" },
            { key: "db_status", label: "DB Status" },
            { key: "e_test", label: "E-Test", type: "checkbox", editable: true },
            { key: "p_test", label: "P-Test", type: "checkbox", editable: true },
        ],
    },
    {
        id: "burnin",
        title: "Burn-in",
        fields: [
            { key: "burn_in_start", label: "Burn In Start", editable: true, type: "datetime" },
            { key: "burn_in_stop", label: "Burn In Stop", editable: true, type: "datetime" },
            { key: "burn_in_op", label: "Burn In Operator", editable: true },
        ],
    },
    {
        id: "lots",
        title: "LOTs",
        layout: "grid",
        fields: [
            { key: "kin_lot", label: "Kintex Lot", editable: true, type: "lot", componentType: "KIN" },
            { key: "pro_lot", label: "ProASIC Lot", editable: true, type: "lot", componentType: "PRO" },
            { key: "gbt_lot", label: "GBT Lot", editable: true, type: "lot", componentType: "GBT" },
            { key: "ina_lot", label: "INA Lot", editable: true, type: "lot", componentType: "INA" },
            { key: "ltm_lot", label: "LTM Lot", editable: true, type: "lot", componentType: "LTM" },
            { key: "mos_lot", label: "MOS Lot", editable: true, type: "lot", componentType: "MOS" },
            { key: "op4_lot", label: "OP4 Lot", editable: true, type: "lot", componentType: "OP4" },
            { key: "ok4_lot", label: "OK4 Lot", editable: true, type: "lot", componentType: "OK4" },
            { key: "ok1_lot", label: "OK1 Lot", editable: true, type: "lot", componentType: "OK1" },
            { key: "mem_lot", label: "MEM Lot", editable: true, type: "lot", componentType: "MEM" },
            { key: "sfp_lot", label: "SFP Lot", editable: true, type: "lot", componentType: "SFP" },
        ],
    },
    {
        id: "sfp",
        title: "SFP+ IDs",
        fields: [
            { key: "a0", label: "A0", editable: true },
            { key: "a1", label: "A1", editable: true },
            { key: "b0", label: "B0", editable: true },
            { key: "b1", label: "B1", editable: true },
        ],
    },
];

const DB_DATETIME_FIELDS = new Set(["burn_in_start", "burn_in_stop"]);

function decodeSerialNo(serialNo) {
    if (serialNo === null || serialNo === undefined || serialNo === "") {
        return null;
    }

    const text = String(serialNo).trim();
    if (!text || text === "---" || text.toLowerCase() === "xxx") {
        return null;
    }

    const digits = text.replace(/\D/g, "");
    if (digits.length !== 7) {
        return null;
    }

    return {
        serial_no: Number(digits),
        tag: digits.slice(0, 2),
        batch_no: digits.slice(2, 4),
        db_no: digits.slice(4, 7),
    };
}

function formatBatchNoFromSerial(serialNo) {
    const decoded = decodeSerialNo(serialNo);
    return decoded ? decoded.batch_no : DAUGHTERBOARD_PLACEHOLDER;
}

function updateDaughterboardSerialSummary(serialNo) {
    const decoded = decodeSerialNo(serialNo);
    const serialEl = document.getElementById("db_summary_serial");
    const tagEl = document.getElementById("db_summary_tag");
    const batchEl = document.getElementById("db_summary_batch_no");
    const dbNoEl = document.getElementById("db_summary_db_no");

    if (serialEl) {
        serialEl.textContent = decoded
            ? String(decoded.serial_no)
            : formatDaughterboardValue("serial_no", serialNo);
    }
    if (tagEl) tagEl.textContent = decoded ? decoded.tag : DAUGHTERBOARD_PLACEHOLDER;
    if (batchEl) batchEl.textContent = decoded ? decoded.batch_no : DAUGHTERBOARD_PLACEHOLDER;
    if (dbNoEl) dbNoEl.textContent = decoded ? decoded.db_no : DAUGHTERBOARD_PLACEHOLDER;
}

function updateRegistrationUI() {
    const registerBtn = document.getElementById("db-register-btn");
    if (registerBtn) {
        registerBtn.hidden = !registrationMode;
        registerBtn.disabled = !registrationMode;
        registerBtn.textContent = registrationExistingSerial ? "Update DB" : "Register DB";
    }
}

function clearDaughterboardBaseline() {
    daughterboardBaseline = null;
    registrationExistingSerial = null;
    registrationDnaChoice = "keep";
}

function formatDnaForCompare(value) {
    return normalizeFieldValue("kintex_a_id", value);
}

function getDnaDiffSummary(daughterboard, options = {}) {
    const programmer = getProgrammerDnas();
    const dbA = formatDnaForCompare(daughterboard?.kintex_a_id);
    const dbB = formatDnaForCompare(daughterboard?.kintex_b_id);
    const readA = formatDnaForCompare(programmer.dna_a);
    const readB = formatDnaForCompare(programmer.dna_b);
    const onlySides = Array.isArray(options.sides) && options.sides.length
        ? new Set(options.sides.map(side => String(side).toUpperCase()))
        : null;

    const sides = [
        {
            side: "A",
            db: dbA,
            read: readA,
            changed: Boolean(readA || dbA) && dbA !== readA,
        },
        {
            side: "B",
            db: dbB,
            read: readB,
            changed: Boolean(readB || dbB) && dbB !== readB,
        },
    ].filter(side => !onlySides || onlySides.has(side.side));

    return {
        sides,
        hasChanges: sides.some(side => side.changed),
        hasReadableDnas: sides.some(side => Boolean(side.read)),
    };
}

function applyRegistrationChosenDnas(daughterboard, choice) {
    const programmer = getProgrammerDnas();
    const useNew = choice === "replace";
    const fieldA = document.getElementById("db_field_kintex_a_readout");
    const fieldB = document.getElementById("db_field_kintex_b_readout");

    const dnaA = useNew && programmer.dna_a
        ? programmer.dna_a
        : daughterboard?.kintex_a_id;
    const dnaB = useNew && programmer.dna_b
        ? programmer.dna_b
        : daughterboard?.kintex_b_id;

    if (fieldA) {
        fieldA.textContent = formatDaughterboardValue("kintex_a_id", dnaA);
    }
    if (fieldB) {
        fieldB.textContent = formatDaughterboardValue("kintex_b_id", dnaB);
    }
}

function closeDnaChoiceModal(choice = null) {
    const modal = document.getElementById("dna-choice-modal");
    if (modal) {
        modal.hidden = true;
    }

    const keepBtn = document.getElementById("dna-choice-keep");
    const replaceBtn = document.getElementById("dna-choice-replace");
    if (keepBtn) {
        keepBtn.textContent = "Keep database DNAs";
    }
    if (replaceBtn) {
        replaceBtn.textContent = "Use newly read DNAs";
    }

    if (dnaChoiceResolver) {
        const resolve = dnaChoiceResolver;
        dnaChoiceResolver = null;
        resolve(choice);
    }
}

function promptDnaChoice(daughterboard, options = {}) {
    const diff = getDnaDiffSummary(daughterboard, options);
    if (!diff.hasChanges) {
        return Promise.resolve("keep");
    }

    const modal = document.getElementById("dna-choice-modal");
    const message = document.getElementById("dna-choice-message");
    const diffEl = document.getElementById("dna-choice-diff");
    const title = document.getElementById("dna-choice-title");
    const keepBtn = document.getElementById("dna-choice-keep");
    const replaceBtn = document.getElementById("dna-choice-replace");

    const defaultTitle = `DNA mismatch for serial ${daughterboard.serial_no}`;
    const defaultMessage = (
        "This daughterboard already exists. Choose whether to keep the DNAs " +
        "stored in the database or replace them with the newly read programmer DNAs."
    );

    if (!modal || !message || !diffEl) {
        const lines = diff.sides
            .filter(side => side.changed)
            .map(side => (
                `Side ${side.side}:\n` +
                `  Database: ${side.db || "(empty)"}\n` +
                `  Newly read: ${side.read || "(empty)"}`
            ))
            .join("\n\n");
        const useNew = confirm(
            `${options.title || defaultTitle}\n\n${lines}\n\n` +
            "OK = use newly read DNAs\nCancel = keep database DNAs"
        );
        return Promise.resolve(useNew ? "replace" : "keep");
    }

    if (title) {
        title.textContent = options.title || defaultTitle;
    }
    message.textContent = options.message || defaultMessage;
    if (keepBtn) {
        keepBtn.textContent = options.keepLabel || "Keep database DNAs";
    }
    if (replaceBtn) {
        replaceBtn.textContent = options.replaceLabel || "Use newly read DNAs";
    }

    diffEl.innerHTML = diff.sides.map(side => `
        <div class="dna-choice-row ${side.changed ? "changed" : ""}">
            <div class="side-label">Kintex ${side.side}${side.changed ? " (different)" : " (same)"}</div>
            <div class="dna-line"><span>Database:</span><span>${side.db || "(empty)"}</span></div>
            <div class="dna-line"><span>Newly read:</span><span>${side.read || "(empty)"}</span></div>
        </div>
    `).join("");

    modal.hidden = false;

    return new Promise(resolve => {
        dnaChoiceResolver = resolve;
    });
}

function initDnaChoiceModal() {
    const keepBtn = document.getElementById("dna-choice-keep");
    const replaceBtn = document.getElementById("dna-choice-replace");
    const modal = document.getElementById("dna-choice-modal");

    if (keepBtn && !keepBtn.dataset.wired) {
        keepBtn.addEventListener("click", () => closeDnaChoiceModal("keep"));
        keepBtn.dataset.wired = "true";
    }
    if (replaceBtn && !replaceBtn.dataset.wired) {
        replaceBtn.addEventListener("click", () => closeDnaChoiceModal("replace"));
        replaceBtn.dataset.wired = "true";
    }
    if (modal && !modal.dataset.wired) {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeDnaChoiceModal("keep");
            }
        });
        modal.dataset.wired = "true";
    }
}

function snapshotDaughterboardBaseline(daughterboard, extra = {}) {
    if (!daughterboard) {
        clearDaughterboardBaseline();
        return;
    }

    const snapshot = {};
    DAUGHTERBOARD_GROUPS.forEach(group => {
        group.fields.forEach(field => {
            if (!field.editable) {
                return;
            }
            snapshot[field.key] = normalizeFieldValue(field.key, daughterboard[field.key]);
        });
    });

    snapshot.kintex_a_id = normalizeFieldValue("kintex_a_id", daughterboard.kintex_a_id);
    snapshot.kintex_b_id = normalizeFieldValue("kintex_b_id", daughterboard.kintex_b_id);
    Object.assign(snapshot, extra);
    daughterboardBaseline = snapshot;
}

function normalizeFieldValue(key, value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }

    if (DB_DATETIME_FIELDS.has(key)) {
        const display = formatDatetimeDisplay(value);
        return display === DAUGHTERBOARD_PLACEHOLDER ? null : display;
    }

    if (key === "e_test" || key === "p_test" || key === "db_status") {
        if (value === "" || String(value).toLowerCase() === "xxx") {
            return null;
        }
        const num = Number(value);
        return Number.isNaN(num) ? null : num;
    }

    const text = String(value).trim();
    if (!text || text.toLowerCase() === "xxx") {
        return null;
    }
    return text;
}

function fieldValuesEqual(key, left, right) {
    return normalizeFieldValue(key, left) === normalizeFieldValue(key, right);
}

function collectDirtyFields(candidateValues) {
    if (!daughterboardBaseline) {
        return { ...candidateValues };
    }

    const dirty = {};
    Object.keys(candidateValues).forEach(key => {
        if (key === "serial_no") {
            return;
        }
        if (!fieldValuesEqual(key, candidateValues[key], daughterboardBaseline[key])) {
            dirty[key] = candidateValues[key];
        }
    });
    return dirty;
}

function getProgrammerDnas() {
    const dnaA = document.getElementById("ku_side_a_dna")?.innerText?.trim();
    const dnaB = document.getElementById("ku_side_b_dna")?.innerText?.trim();
    return {
        dna_a: dnaA && dnaA !== "---" ? dnaA : null,
        dna_b: dnaB && dnaB !== "---" ? dnaB : null,
    };
}

function applyRegistrationDbDnas(daughterboard) {
    applyRegistrationChosenDnas(daughterboard, registrationDnaChoice);
}

function exitRegistrationMode() {
    registrationMode = false;
    registrationExistingSerial = null;
    registrationDnaChoice = "keep";
    closeDnaChoiceModal(null);
    if (serialLookupTimer) {
        clearTimeout(serialLookupTimer);
        serialLookupTimer = null;
    }
    updateRegistrationUI();
}

function enterRegistrationMode() {
    registrationMode = true;
    currentDaughterboardSerial = null;
    currentDaughterboardData = null;
    clearDaughterboardBaseline();
    globalEditUnlocked = true;
    Object.keys(groupEditUnlocked).forEach(groupId => {
        groupEditUnlocked[groupId] = true;
    });

    setDaughterboardPlaceholderValues({ preserveRegistration: true });
    setDaughterboardSectionState(
        "warning",
        "Registration mode: enter Serial Number, then click Register DB."
    );
    updateDaughterboardSerialSummary(null);
    updateRegistrationUI();
    updateEditModeUI();
}

async function lookupSerialForRegistration(serialNo) {
    const requestId = ++serialLookupRequestId;
    try {
        const res = await fetch(`api/daughterboard/${serialNo}`);
        if (requestId !== serialLookupRequestId || !registrationMode) {
            return;
        }

        if (res.status === 404) {
            registrationExistingSerial = null;
            currentDaughterboardSerial = null;
            currentDaughterboardData = null;
            clearDaughterboardBaseline();
            const serialRaw = document.getElementById("db_input_serial_no")?.value;
            setDaughterboardPlaceholderValues({ preserveRegistration: true });
            const serialInput = document.getElementById("db_input_serial_no");
            if (serialInput && serialRaw) {
                serialInput.value = serialRaw;
            }
            updateDaughterboardSerialSummary(serialNo);
            setDaughterboardSectionState(
                "warning",
                `Serial ${serialNo} is not in the database. Fill required fields and click Register DB.`
            );
            updateRegistrationUI();
            updateEditModeUI();
            return;
        }

        if (!res.ok) {
            throw new Error("lookup failed");
        }

        const data = await res.json();
        if (requestId !== serialLookupRequestId || !registrationMode) {
            return;
        }

        loadExistingDaughterboardForRegistration(data.daughterboard);
    } catch (err) {
        if (requestId !== serialLookupRequestId || !registrationMode) {
            return;
        }
        console.error("Failed to look up daughterboard serial:", err);
        setDaughterboardSectionState("error", `Failed to look up serial ${serialNo}.`);
    }
}

async function loadExistingDaughterboardForRegistration(daughterboard) {
    if (!daughterboard) {
        return;
    }

    registrationExistingSerial = daughterboard.serial_no;
    currentDaughterboardSerial = daughterboard.serial_no;
    currentDaughterboardData = daughterboard;
    snapshotDaughterboardBaseline(daughterboard);

    Object.keys(groupEditUnlocked).forEach(groupId => {
        groupEditUnlocked[groupId] = true;
    });

    applyDaughterboardValues(daughterboard);

    const dnaDiff = getDnaDiffSummary(daughterboard);
    if (dnaDiff.hasChanges) {
        const choice = await promptDnaChoice(daughterboard);
        if (!registrationMode || registrationExistingSerial !== daughterboard.serial_no) {
            return;
        }
        registrationDnaChoice = choice || "keep";
    } else {
        registrationDnaChoice = "keep";
    }

    applyRegistrationChosenDnas(daughterboard, registrationDnaChoice);

    const serialInput = document.getElementById("db_input_serial_no");
    if (serialInput) {
        serialInput.value = String(daughterboard.serial_no);
        serialInput.hidden = false;
        serialInput.disabled = false;
        serialInput.readOnly = false;
        const display = document.getElementById("db_field_serial_no");
        if (display) {
            display.hidden = true;
        }
    }

    updateDaughterboardSerialSummary(daughterboard.serial_no);
    const dnaNote = registrationDnaChoice === "replace"
        ? " Newly read DNAs will be written on Update."
        : dnaDiff.hasChanges
            ? " Database DNAs will be kept."
            : "";
    setDaughterboardSectionState(
        "matched",
        `Serial ${daughterboard.serial_no} already exists — fields loaded. Only changed values will be saved.${dnaNote}`
    );
    updateRegistrationUI();
    updateEditModeUI();
}

function scheduleSerialLookupFromInput() {
    if (!registrationMode) {
        return;
    }

    const serialInput = document.getElementById("db_input_serial_no");
    const decoded = decodeSerialNo(serialInput?.value);
    updateDaughterboardSerialSummary(decoded ? decoded.serial_no : null);

    if (serialLookupTimer) {
        clearTimeout(serialLookupTimer);
        serialLookupTimer = null;
    }

    if (!decoded) {
        registrationExistingSerial = null;
        clearDaughterboardBaseline();
        updateRegistrationUI();
        return;
    }

    serialLookupTimer = setTimeout(() => {
        serialLookupTimer = null;
        lookupSerialForRegistration(decoded.serial_no);
    }, 400);
}

function collectRegistrationFieldValues() {
    const values = {};
    DAUGHTERBOARD_GROUPS.forEach(group => {
        group.fields.forEach(field => {
            if (!field.editable && !field.registerEditable) {
                return;
            }

            if (field.type === "checkbox") {
                const checkbox = document.getElementById(`db_checkbox_${field.key}`);
                if (checkbox) {
                    values[field.key] = checkbox.checked ? 1 : 0;
                }
                return;
            }

            if (field.type === "lot") {
                const select = document.getElementById(`db_select_${field.key}`);
                if (select) {
                    values[field.key] = select.value.trim();
                }
                return;
            }

            if (field.type === "datetime") {
                const input = document.getElementById(`db_input_${field.key}`);
                if (input) {
                    values[field.key] = inputValueToDatetime(input.value);
                }
                return;
            }

            const input = document.getElementById(`db_input_${field.key}`);
            if (input) {
                values[field.key] = input.value.trim();
            }
        });
    });
    return values;
}

function collectDnaUpdatesForRegistration() {
    if (registrationDnaChoice !== "replace") {
        return {};
    }

    const { dna_a: dnaA, dna_b: dnaB } = getProgrammerDnas();
    const updates = {};

    if (dnaA && !fieldValuesEqual("kintex_a_id", dnaA, daughterboardBaseline?.kintex_a_id)) {
        updates.kintex_a_id = dnaA;
    }
    if (dnaB && !fieldValuesEqual("kintex_b_id", dnaB, daughterboardBaseline?.kintex_b_id)) {
        updates.kintex_b_id = dnaB;
    }
    return updates;
}

async function registerDaughterboard() {
    const serialInput = document.getElementById("db_input_serial_no");
    const serialRaw = serialInput?.value?.trim();
    if (!serialRaw) {
        alert("Serial Number is required to register this daughterboard.");
        serialInput?.focus();
        return;
    }

    const decoded = decodeSerialNo(serialRaw);
    if (!decoded) {
        alert("Enter a valid 7-digit daughterboard serial number (TTBBDDD).");
        serialInput?.focus();
        return;
    }

    const { dna_a: dnaA, dna_b: dnaB } = getProgrammerDnas();
    const isUpdate = Boolean(registrationExistingSerial);

    if (!isUpdate && (!dnaA || !dnaB)) {
        alert("Both side A and side B KU DNAs are required before registering.");
        return;
    }

    const registerBtn = document.getElementById("db-register-btn");
    if (registerBtn) {
        registerBtn.disabled = true;
        registerBtn.textContent = isUpdate ? "Updating..." : "Registering...";
    }

    const fieldValues = collectRegistrationFieldValues();
    delete fieldValues.serial_no;

    try {
        if (isUpdate) {
            const dirtyFields = collectDirtyFields(fieldValues);
            Object.assign(dirtyFields, collectDnaUpdatesForRegistration());

            if (Object.keys(dirtyFields).length === 0) {
                alert("No fields were changed.");
                return;
            }

            const res = await fetch(`api/daughterboard/${decoded.serial_no}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: dirtyFields }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "update failed");
            }

            exitRegistrationMode();
            if (data.daughterboard) {
                renderDaughterboardData(data.daughterboard);
                const forceDnaSync = Object.prototype.hasOwnProperty.call(dirtyFields, "kintex_a_id")
                    || Object.prototype.hasOwnProperty.call(dirtyFields, "kintex_b_id");
                syncKuDbBoxesFromDaughterboard(
                    data.daughterboard,
                    forceDnaSync ? { force: true } : {}
                );
            }
            return;
        }

        const res = await fetch("api/daughterboard/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                serial_no: decoded.serial_no,
                dna_a: dnaA,
                dna_b: dnaB,
                fields: fieldValues,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "registration failed");
        }

        exitRegistrationMode();
        if (data.daughterboard) {
            renderDaughterboardData(data.daughterboard);
            syncKuDbBoxesFromDaughterboard(data.daughterboard, { force: true });
        }
    } catch (err) {
        console.error("Failed to register/update daughterboard:", err);
        alert(`Failed to ${isUpdate ? "update" : "register"} daughterboard: ${err.message}`);
    } finally {
        if (registerBtn) {
            registerBtn.disabled = false;
            registerBtn.textContent = registrationExistingSerial ? "Update DB" : "Register DB";
        }
    }
}

function formatDatetimeDisplay(value) {
    if (value === null || value === undefined || value === "") {
        return DAUGHTERBOARD_PLACEHOLDER;
    }

    const text = String(value).trim().replace("T", " ");
    if (text.toLowerCase() === "xxx") {
        return DAUGHTERBOARD_PLACEHOLDER;
    }

    const match = text.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?/);
    if (!match) {
        return text;
    }

    const seconds = match[3] !== undefined ? match[3] : "00";
    return `${match[1]} ${match[2]}:${seconds}`;
}

function datetimeToInputValue(value) {
    const display = formatDatetimeDisplay(value);
    if (display === DAUGHTERBOARD_PLACEHOLDER) {
        return "";
    }
    return display.replace(" ", "T");
}

function inputValueToDatetime(value) {
    if (!value || !value.trim()) {
        return null;
    }

    const text = value.trim().replace("T", " ");
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) {
        return `${text}:00`;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        return text;
    }
    return text;
}

function getDaughterboardGroup(groupId) {
    return DAUGHTERBOARD_GROUPS.find(group => group.id === groupId);
}

async function loadComponentLots() {
    try {
        const res = await fetch("api/component_lots");
        if (!res.ok) {
            throw new Error("failed to load component lots");
        }
        componentLotsByType = await res.json();
        refreshAllLotSelects();
    } catch (err) {
        console.error("Failed to load component lots:", err);
    }
}

function populateLotSelect(fieldKey, componentType, selectedValue) {
    const select = document.getElementById(`db_select_${fieldKey}`);
    if (!select) {
        return;
    }

    const lots = componentLotsByType[componentType] || [];
    const normalized = formatDaughterboardValue(fieldKey, selectedValue);
    const value = normalized === DAUGHTERBOARD_PLACEHOLDER ? "" : normalized;

    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = DAUGHTERBOARD_PLACEHOLDER;
    placeholder.textContent = DAUGHTERBOARD_PLACEHOLDER;
    select.appendChild(placeholder);

    lots.forEach(lot => {
        const option = document.createElement("option");
        option.value = lot;
        option.textContent = lot;
        select.appendChild(option);
    });

    if (value && !lots.includes(value)) {
        const custom = document.createElement("option");
        custom.value = value;
        custom.textContent = value;
        select.appendChild(custom);
    }

    select.value = value || DAUGHTERBOARD_PLACEHOLDER;
}

function refreshAllLotSelects() {
    DAUGHTERBOARD_GROUPS.forEach(group => {
        group.fields.forEach(field => {
            if (field.type !== "lot") {
                return;
            }
            const select = document.getElementById(`db_select_${field.key}`);
            const currentValue = select ? select.value : DAUGHTERBOARD_PLACEHOLDER;
            populateLotSelect(field.key, field.componentType, currentValue);
        });
    });
}

function isGroupEditable(groupId) {
    return globalEditUnlocked && groupEditUnlocked[groupId] === true;
}

function isFieldEditable(groupId, field) {
    if (registrationMode) {
        if (field.registerEditable || field.editable) {
            return isGroupEditable(groupId);
        }
        return false;
    }
    return Boolean(field.editable) && isGroupEditable(groupId);
}

function isEditIdleTrackingActive() {
    return globalEditUnlocked || registrationMode;
}

function updateEditIdleCountdownUI() {
    const el = document.getElementById("db-edit-idle-countdown");
    if (!el) {
        return;
    }

    if (!isEditIdleTrackingActive()) {
        el.hidden = true;
        el.textContent = "";
        el.classList.remove("is-warning");
        return;
    }

    el.hidden = false;
    el.textContent = `Auto-lock: ${editIdleSecondsRemaining}s`;
    el.classList.toggle("is-warning", editIdleSecondsRemaining <= 10);
}

function resetEditIdleCountdown() {
    editIdleSecondsRemaining = EDIT_IDLE_TIMEOUT_SEC;
    updateEditIdleCountdownUI();
}

function stopEditIdleTimer() {
    if (editIdleInterval !== null) {
        clearInterval(editIdleInterval);
        editIdleInterval = null;
    }
    updateEditIdleCountdownUI();
}

function tickEditIdleTimer() {
    editIdleSecondsRemaining -= 1;
    updateEditIdleCountdownUI();

    if (editIdleSecondsRemaining <= 0) {
        stopEditIdleTimer();
        lockAllEditModes(true);
    }
}

function startEditIdleTimer() {
    stopEditIdleTimer();
    if (!isEditIdleTrackingActive()) {
        return;
    }

    resetEditIdleCountdown();
    editIdleInterval = setInterval(tickEditIdleTimer, 1000);
}

function syncEditIdleTimer() {
    if (isEditIdleTrackingActive()) {
        if (editIdleInterval === null) {
            startEditIdleTimer();
        } else {
            updateEditIdleCountdownUI();
        }
        return;
    }

    stopEditIdleTimer();
}

function onEditIdleActivity() {
    if (!isEditIdleTrackingActive()) {
        return;
    }
    resetEditIdleCountdown();
}

function initEditIdleTracking() {
    if (editIdleListenersAttached) {
        return;
    }

    ["mousedown", "keydown", "click", "touchstart", "input", "change", "scroll"].forEach(eventName => {
        document.addEventListener(eventName, onEditIdleActivity, { passive: true });
    });
    editIdleListenersAttached = true;
}

function lockAllEditModes(reloadFromData = true) {
    exitRegistrationMode();
    globalEditUnlocked = false;
    Object.keys(groupEditUnlocked).forEach(groupId => {
        groupEditUnlocked[groupId] = false;
    });

    if (reloadFromData && currentDaughterboardData) {
        applyDaughterboardValues(currentDaughterboardData);
    }

    updateEditModeUI();
}

function updateEditModeUI() {
    const globalBtn = document.getElementById("db-global-edit-btn");
    if (globalBtn) {
        globalBtn.textContent = globalEditUnlocked ? "Global: Unlocked" : "Global: Locked";
        globalBtn.classList.toggle("unlocked", globalEditUnlocked);
        globalBtn.classList.toggle("locked", !globalEditUnlocked);
        globalBtn.disabled = !currentDaughterboardSerial && !registrationMode;
    }

    DAUGHTERBOARD_GROUPS.forEach(group => {
        const groupBtn = document.getElementById(`db-group-edit-${group.id}`);
        const saveBtn = document.getElementById(`db-group-save-${group.id}`);
        const panel = document.getElementById(`db-panel-${group.id}`);
        const groupIsEditable = isGroupEditable(group.id);
        const canEditGroups = Boolean(currentDaughterboardSerial) || registrationMode;

        if (groupBtn) {
            groupBtn.textContent = groupIsEditable ? "Edit: On" : "Edit: Locked";
            groupBtn.classList.toggle("unlocked", groupIsEditable);
            groupBtn.classList.toggle("locked", !groupIsEditable);
            groupBtn.disabled = !globalEditUnlocked || !canEditGroups;
        }

        if (saveBtn) {
            saveBtn.hidden = !groupIsEditable || registrationMode;
        }

        if (panel) {
            panel.classList.toggle("db-panel-editing", groupIsEditable);
        }

        group.fields.forEach(field => {
            if (field.readoutId) {
                return;
            }

            if (field.type === "checkbox") {
                const checkbox = document.getElementById(`db_checkbox_${field.key}`);
                if (checkbox) {
                    checkbox.disabled = ((!currentDaughterboardSerial && !registrationMode) || !isFieldEditable(group.id, field));
                }
                return;
            }

            if (field.type === "lot") {
                const select = document.getElementById(`db_select_${field.key}`);
                if (!select) {
                    return;
                }
                const editable = isFieldEditable(group.id, field);
                select.disabled = ((!currentDaughterboardSerial && !registrationMode) || !editable);
                select.classList.toggle("is-editing", editable);
                return;
            }

            if (field.type === "datetime") {
                const editable = isFieldEditable(group.id, field);
                const display = document.getElementById(`db_field_${field.key}`);
                const input = document.getElementById(`db_input_${field.key}`);
                if (display) {
                    display.hidden = editable;
                }
                if (input) {
                    input.hidden = !editable;
                    input.disabled = (!currentDaughterboardSerial && !registrationMode) || !editable;
                    input.classList.toggle("is-editing", editable);
                }
                return;
            }

            if (field.registerEditable) {
                const editable = isFieldEditable(group.id, field);
                const display = document.getElementById(`db_field_${field.key}`);
                const input = document.getElementById(`db_input_${field.key}`);
                if (display) {
                    display.hidden = editable;
                }
                if (input) {
                    input.hidden = !editable;
                    input.readOnly = !editable;
                    input.disabled = !registrationMode || !editable;
                    input.classList.toggle("is-editing", editable);
                }
                return;
            }

            if (!field.editable) {
                return;
            }

            const input = document.getElementById(`db_input_${field.key}`);
            if (!input) {
                return;
            }

            const editable = isFieldEditable(group.id, field);
            input.readOnly = !editable;
            input.disabled = !currentDaughterboardSerial && !registrationMode;
            input.classList.toggle("is-editing", editable);
        });
    });

    updateRegistrationUI();
    syncEditIdleTimer();
}

function initDaughterboardEditControls() {
    const globalBtn = document.getElementById("db-global-edit-btn");
    if (globalBtn && !globalBtn.dataset.wired) {
        globalBtn.addEventListener("click", () => {
            if (!currentDaughterboardSerial && !registrationMode) {
                return;
            }

            if (!globalEditUnlocked) {
                const confirmed = confirm(
                    "Warning: unlock global edit mode?\n\n" +
                    "Group edit toggles will be enabled. Database changes still require group edit + Save."
                );
                if (!confirmed) {
                    return;
                }
                globalEditUnlocked = true;
            } else {
                lockAllEditModes(true);
                return;
            }

            updateEditModeUI();
        });
        globalBtn.dataset.wired = "true";
    }

    const registerBtn = document.getElementById("db-register-btn");
    if (registerBtn && !registerBtn.dataset.wired) {
        registerBtn.addEventListener("click", registerDaughterboard);
        registerBtn.dataset.wired = "true";
    }

    const serialInput = document.getElementById("db_input_serial_no");
    if (serialInput && !serialInput.dataset.wiredSummary) {
        serialInput.addEventListener("input", () => {
            scheduleSerialLookupFromInput();
        });
        serialInput.dataset.wiredSummary = "true";
    }
}

function toggleGroupEditMode(groupId) {
    if (!globalEditUnlocked || (!currentDaughterboardSerial && !registrationMode)) {
        return;
    }

    const group = getDaughterboardGroup(groupId);
    if (!group) {
        return;
    }

    if (!groupEditUnlocked[groupId]) {
        groupEditUnlocked[groupId] = true;
    } else {
        groupEditUnlocked[groupId] = false;
        if (currentDaughterboardData) {
            applyDaughterboardValues(currentDaughterboardData);
        }
    }

    updateEditModeUI();
}

function collectGroupFieldValues(groupId) {
    const group = getDaughterboardGroup(groupId);
    if (!group) {
        return {};
    }

    const values = {};
    group.fields.forEach(field => {
        if (!field.editable) {
            return;
        }

        if (field.type === "checkbox") {
            const checkbox = document.getElementById(`db_checkbox_${field.key}`);
            if (checkbox) {
                values[field.key] = checkbox.checked ? 1 : 0;
            }
            return;
        }

        if (field.type === "lot") {
            const select = document.getElementById(`db_select_${field.key}`);
            if (select) {
                values[field.key] = select.value.trim();
            }
            return;
        }

        if (field.type === "datetime") {
            const input = document.getElementById(`db_input_${field.key}`);
            if (input) {
                values[field.key] = inputValueToDatetime(input.value);
            }
            return;
        }

        const input = document.getElementById(`db_input_${field.key}`);
        if (input) {
            values[field.key] = input.value.trim();
        }
    });

    return values;
}

async function saveGroupEdits(groupId) {
    if (!isGroupEditable(groupId) || !currentDaughterboardSerial) {
        return;
    }

    const group = getDaughterboardGroup(groupId);
    const fields = collectDirtyFields(collectGroupFieldValues(groupId));

    if (Object.keys(fields).length === 0) {
        groupEditUnlocked[groupId] = false;
        if (currentDaughterboardData) {
            applyDaughterboardValues(currentDaughterboardData);
        }
        updateEditModeUI();
        return;
    }

    const saveBtn = document.getElementById(`db-group-save-${groupId}`);
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

    try {
        const res = await fetch(`api/daughterboard/${currentDaughterboardSerial}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "update failed");
        }

        if (data.daughterboard) {
            currentDaughterboardData = data.daughterboard;
            renderDaughterboardData(data.daughterboard, { preserveEditModes: true });
        }

        groupEditUnlocked[groupId] = false;
        updateEditModeUI();
    } catch (err) {
        console.error("Failed to save daughterboard group:", err);
        alert(`Failed to save ${group.title}: ${err.message}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
        }
    }
}

function getReadoutDna(readoutId) {
    const text = document.getElementById(readoutId)?.innerText?.trim();
    if (!text || text === "---") {
        return DAUGHTERBOARD_PLACEHOLDER;
    }
    return text;
}

function initDaughterboardGrid() {
    const panels = document.getElementById("daughterboard-data-panels");
    if (!panels || panels.dataset.initialized === "true") {
        return;
    }

    panels.innerHTML = "";

    DAUGHTERBOARD_GROUPS.forEach(group => {
        const panel = document.createElement("div");
        panel.className = "db-panel";
        panel.id = `db-panel-${group.id}`;

        const header = document.createElement("div");
        header.className = "db-panel-header";
        header.innerHTML = `
            <h3>${group.title}</h3>
            <div class="db-panel-actions">
                <button type="button" class="db-edit-btn locked" id="db-group-edit-${group.id}" disabled>
                    Edit: Locked
                </button>
                <button type="button" class="db-save-btn" id="db-group-save-${group.id}" hidden>
                    Save
                </button>
            </div>
        `;
        panel.appendChild(header);

        const editBtn = header.querySelector(`#db-group-edit-${group.id}`);
        editBtn.addEventListener("click", () => toggleGroupEditMode(group.id));

        const saveBtn = header.querySelector(`#db-group-save-${group.id}`);
        saveBtn.addEventListener("click", () => saveGroupEdits(group.id));

        const fieldsWrap = document.createElement("div");
        fieldsWrap.className = "db-panel-fields";
        if (group.layout === "grid") {
            fieldsWrap.classList.add("lots-grid");
        }

        group.fields.forEach(field => {
            const fieldEl = document.createElement("div");
            fieldEl.className = "daughterboard-field";

            if (field.type === "checkbox") {
                fieldEl.innerHTML = `
                    <span class="daughterboard-field-line checkbox-field">
                        <span class="daughterboard-field-label">${field.label}:</span>
                        <input
                            type="checkbox"
                            class="db-test-checkbox"
                            id="db_checkbox_${field.key}"
                            data-field="${field.key}"
                            disabled
                        >
                    </span>
                `;
            } else if (field.type === "lot") {
                fieldEl.innerHTML = `
                    <span class="daughterboard-field-line">
                        <span class="daughterboard-field-label">${field.label}:</span>
                        <select
                            class="db-field-select"
                            id="db_select_${field.key}"
                            data-field="${field.key}"
                            data-group="${group.id}"
                            disabled
                        ></select>
                    </span>
                `;
                populateLotSelect(field.key, field.componentType, DAUGHTERBOARD_PLACEHOLDER);
            } else if (field.type === "datetime") {
                fieldEl.innerHTML = `
                    <span class="daughterboard-field-line daughterboard-datetime-field">
                        <span class="daughterboard-field-label">${field.label}:</span>
                        <span class="daughterboard-field-value db-datetime-display" id="db_field_${field.key}">${DAUGHTERBOARD_PLACEHOLDER}</span>
                        <input
                            type="datetime-local"
                            step="1"
                            class="db-field-input db-datetime-input"
                            id="db_input_${field.key}"
                            data-field="${field.key}"
                            data-group="${group.id}"
                            hidden
                            disabled
                        >
                    </span>
                `;
            } else if (field.registerEditable) {
                fieldEl.innerHTML = `
                    <span class="daughterboard-field-line">
                        <span class="daughterboard-field-label">${field.label}:</span>
                        <span class="daughterboard-field-value" id="db_field_${field.key}">${DAUGHTERBOARD_PLACEHOLDER}</span>
                        <input
                            type="number"
                            class="db-field-input"
                            id="db_input_${field.key}"
                            data-field="${field.key}"
                            data-group="${group.id}"
                            hidden
                            disabled
                        >
                    </span>
                `;
            } else if (field.editable) {
                const inputType = field.inputType || "text";
                fieldEl.innerHTML = `
                    <span class="daughterboard-field-line">
                        <span class="daughterboard-field-label">${field.label}:</span>
                        <input
                            type="${inputType}"
                            class="db-field-input"
                            id="db_input_${field.key}"
                            data-field="${field.key}"
                            data-group="${group.id}"
                            value="${DAUGHTERBOARD_PLACEHOLDER}"
                            readonly
                            disabled
                        >
                    </span>
                `;
            } else {
                fieldEl.innerHTML = `
                    <span class="daughterboard-field-line">
                        <span class="daughterboard-field-label">${field.label}:</span>
                        <span class="daughterboard-field-value" id="db_field_${field.key}">${DAUGHTERBOARD_PLACEHOLDER}</span>
                    </span>
                `;
            }

            fieldsWrap.appendChild(fieldEl);
        });

        panel.appendChild(fieldsWrap);
        panels.appendChild(panel);
    });

    panels.dataset.initialized = "true";
    initDaughterboardEditControls();
}

function updateDaughterboardReadoutDnas() {
    const fieldA = document.getElementById("db_field_kintex_a_readout");
    const fieldB = document.getElementById("db_field_kintex_b_readout");
    if (fieldA) fieldA.textContent = getReadoutDna("ku_side_a_dna");
    if (fieldB) fieldB.textContent = getReadoutDna("ku_side_b_dna");
}

function setTestCheckbox(field, value) {
    const checkbox = document.getElementById(`db_checkbox_${field}`);
    if (!checkbox) return;
    checkbox.checked = Number(value) === 1;
}

function applyDaughterboardValues(daughterboard) {
    if (!daughterboard) {
        return;
    }

    DAUGHTERBOARD_GROUPS.forEach(group => {
        group.fields.forEach(field => {
            if (field.type === "checkbox") {
                setTestCheckbox(field.key, daughterboard[field.key]);
                return;
            }

            if (field.type === "lot") {
                populateLotSelect(field.key, field.componentType, daughterboard[field.key]);
                return;
            }

            if (field.type === "datetime") {
                const display = formatDatetimeDisplay(daughterboard[field.key]);
                const displayEl = document.getElementById(`db_field_${field.key}`);
                const input = document.getElementById(`db_input_${field.key}`);
                if (displayEl) {
                    displayEl.textContent = display;
                }
                if (input) {
                    input.value = datetimeToInputValue(daughterboard[field.key]);
                }
                return;
            }

            if (field.registerEditable) {
                const display = formatDaughterboardValue(field.key, daughterboard[field.key]);
                const displayEl = document.getElementById(`db_field_${field.key}`);
                const input = document.getElementById(`db_input_${field.key}`);
                if (displayEl) {
                    displayEl.textContent = display;
                }
                if (input) {
                    input.value = display === DAUGHTERBOARD_PLACEHOLDER ? "" : display;
                }
                return;
            }

            if (field.readoutId) {
                return;
            }

            const value = formatDaughterboardValue(field.key, daughterboard[field.key]);
            if (field.editable) {
                const input = document.getElementById(`db_input_${field.key}`);
                if (input) {
                    input.value = value;
                }
            } else {
                const el = document.getElementById(`db_field_${field.key}`);
                if (el) {
                    el.textContent = value;
                }
            }
        });
    });

    updateDaughterboardReadoutDnas();
}

function setDaughterboardPlaceholderValues(options = {}) {
    const preserveRegistration = options.preserveRegistration === true;
    initDaughterboardGrid();
    if (!preserveRegistration) {
        currentDaughterboardSerial = null;
        currentDaughterboardData = null;
        lockAllEditModes(false);
        updateDaughterboardSerialSummary(null);
    }

    DAUGHTERBOARD_GROUPS.forEach(group => {
        group.fields.forEach(field => {
            if (field.type === "checkbox") {
                setTestCheckbox(field.key, 0);
                return;
            }
            if (field.type === "lot") {
                populateLotSelect(field.key, field.componentType, DAUGHTERBOARD_PLACEHOLDER);
                const select = document.getElementById(`db_select_${field.key}`);
                if (select) {
                    select.disabled = true;
                }
                return;
            }
            if (field.type === "datetime") {
                const displayEl = document.getElementById(`db_field_${field.key}`);
                const input = document.getElementById(`db_input_${field.key}`);
                if (displayEl) {
                    displayEl.textContent = DAUGHTERBOARD_PLACEHOLDER;
                    displayEl.hidden = false;
                }
                if (input) {
                    input.value = "";
                    input.hidden = true;
                    input.disabled = true;
                }
                return;
            }
            if (field.registerEditable) {
                const displayEl = document.getElementById(`db_field_${field.key}`);
                const input = document.getElementById(`db_input_${field.key}`);
                if (displayEl) {
                    displayEl.textContent = DAUGHTERBOARD_PLACEHOLDER;
                    displayEl.hidden = !preserveRegistration;
                }
                if (input) {
                    input.value = "";
                    input.hidden = preserveRegistration ? false : true;
                    input.disabled = !preserveRegistration;
                }
                return;
            }
            if (field.readoutId) {
                return;
            }
            if (field.editable) {
                const input = document.getElementById(`db_input_${field.key}`);
                if (input) {
                    input.value = DAUGHTERBOARD_PLACEHOLDER;
                    input.readOnly = true;
                    input.disabled = true;
                }
            } else {
                const el = document.getElementById(`db_field_${field.key}`);
                if (el) el.textContent = DAUGHTERBOARD_PLACEHOLDER;
            }
        });
    });

    updateDaughterboardReadoutDnas();
    updateEditModeUI();
}

function formatDaughterboardValue(key, value) {
    if (value === null || value === undefined || value === "") {
        return DAUGHTERBOARD_PLACEHOLDER;
    }
    if (DB_DATETIME_FIELDS.has(key)) {
        return formatDatetimeDisplay(value);
    }
    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }
    return String(value);
}

function resetDaughterboardSection(message) {
    exitRegistrationMode();
    clearDaughterboardBaseline();
    const status = document.getElementById("daughterboard-data-status");
    if (!status) return;

    status.className = "daughterboard-status";
    status.textContent = message || "No matched daughterboard";
    updateDaughterboardSerialSummary(null);
    setDaughterboardPlaceholderValues();
}

function setDaughterboardSectionState(state, message) {
    const status = document.getElementById("daughterboard-data-status");
    if (!status) return;
    status.className = `daughterboard-status ${state}`;
    status.textContent = message;
}

function renderDaughterboardData(daughterboard, options = {}) {
    if (!daughterboard) return;

    exitRegistrationMode();
    const preserveEditModes = options.preserveEditModes === true;
    const savedGlobal = globalEditUnlocked;
    const savedGroups = { ...groupEditUnlocked };

    initDaughterboardGrid();
    currentDaughterboardSerial = daughterboard.serial_no;
    currentDaughterboardData = daughterboard;
    snapshotDaughterboardBaseline(daughterboard);

    const decoded = daughterboard.serial_decoded || decodeSerialNo(daughterboard.serial_no);
    const batchLabel = decoded ? decoded.batch_no : DAUGHTERBOARD_PLACEHOLDER;
    setDaughterboardSectionState(
        "matched",
        `Matched daughterboard serial ${daughterboard.serial_no} (batch ${batchLabel}).`
    );

    updateDaughterboardSerialSummary(daughterboard.serial_no);
    applyDaughterboardValues(daughterboard);

    if (preserveEditModes) {
        globalEditUnlocked = savedGlobal;
        Object.assign(groupEditUnlocked, savedGroups);
    } else {
        lockAllEditModes(false);
    }

    updateEditModeUI();
}

async function refreshDaughterboardSectionFromDnas() {
    clearDaughterboardBaseline();

    const dnaA = document.getElementById("ku_side_a_dna")?.innerText;
    const dnaB = document.getElementById("ku_side_b_dna")?.innerText;

    if (!dnaA || dnaA === "---" || !dnaB || dnaB === "---") {
        resetDaughterboardSection("Waiting for both side A and side B KU DNAs.");
        return;
    }

    try {
        const res = await fetch("api/daughterboard/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dna_a: dnaA, dna_b: dnaB }),
        });
        const data = await res.json();

        if (data.status === "matched" && data.daughterboard) {
            renderDaughterboardData(data.daughterboard);
            return;
        }

        if (data.status === "partial" && data.daughterboard) {
            await handlePartialDaughterboardMatch(data);
            return;
        }

        if (data.both_unregistered) {
            const register = confirm(
                "Neither KU DNA is registered in the database.\n\nRegister this daughterboard now?"
            );
            if (register) {
                enterRegistrationMode();
                return;
            }
        }

        const state = ["not_found", "mismatch_serial", "mismatch_side"].includes(data.status)
            ? "error"
            : "warning";
        setDaughterboardSectionState(state, data.message || "Could not match daughterboard data.");
        updateDaughterboardSerialSummary(null);
        setDaughterboardPlaceholderValues();
    } catch (err) {
        console.error("Failed to load daughterboard data:", err);
        setDaughterboardSectionState("error", "Failed to load daughterboard data from database.");
        setDaughterboardPlaceholderValues();
    }
}

async function handlePartialDaughterboardMatch(data) {
    const daughterboard = data.daughterboard;
    const missingSide = String(data.missing_side || "").toUpperCase();
    const foundSide = String(data.found_side || "").toUpperCase();
    const dnaField = missingSide === "A" ? "kintex_a_id" : "kintex_b_id";
    const programmer = getProgrammerDnas();
    const newDna = missingSide === "A" ? programmer.dna_a : programmer.dna_b;

    renderDaughterboardData(daughterboard);
    syncKuDbBoxesFromDaughterboard(daughterboard, { sides: [foundSide], force: true });
    setKuSideDbInfo(missingSide, "Not in DB", "---");
    styleKuDbBoxes();

    setDaughterboardSectionState(
        "warning",
        data.message || `Only side ${foundSide} DNA is registered for serial ${daughterboard.serial_no}.`
    );

    const choice = await promptDnaChoice(daughterboard, {
        title: `Only side ${foundSide} DNA is registered`,
        message: (
            `Serial ${daughterboard.serial_no} was loaded from the registered side ${foundSide} DNA. ` +
            `Side ${missingSide} DNA is not registered. Update Kintex ${missingSide} with the newly read DNA?`
        ),
        sides: [missingSide],
        keepLabel: "Keep database DNA",
        replaceLabel: `Update Kintex ${missingSide} DNA`,
    });

    if (choice !== "replace" || !newDna) {
        setDaughterboardSectionState(
            "matched",
            `Loaded serial ${daughterboard.serial_no} from side ${foundSide}. Kintex ${missingSide} DNA left unchanged.`
        );
        return;
    }

    try {
        const res = await fetch(`api/daughterboard/${daughterboard.serial_no}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { [dnaField]: newDna } }),
        });
        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.error || "update failed");
        }

        if (payload.daughterboard) {
            renderDaughterboardData(payload.daughterboard);
            syncKuDbBoxesFromDaughterboard(payload.daughterboard, { force: true });
            setDaughterboardSectionState(
                "matched",
                `Updated Kintex ${missingSide} DNA for serial ${payload.daughterboard.serial_no}.`
            );
        }
    } catch (err) {
        console.error("Failed to update missing DNA:", err);
        alert(`Failed to update Kintex ${missingSide} DNA: ${err.message}`);
        setDaughterboardSectionState(
            "error",
            `Loaded serial ${daughterboard.serial_no}, but Kintex ${missingSide} DNA update failed.`
        );
    }
}

async function refreshDaughterboardSectionFromSerial(serial) {
    if (!serial || serial === "---" || serial === "Not in DB") {
        resetDaughterboardSection("Waiting for a matched daughterboard serial.");
        return;
    }

    try {
        const res = await fetch(`api/daughterboard/${serial}`);
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        renderDaughterboardData(data.daughterboard);
    } catch (err) {
        setDaughterboardSectionState("error", `Daughterboard ${serial} not found in database.`);
        setDaughterboardPlaceholderValues();
    }
}


function resetStatusBoxesForKUAction(action) {
    // Map KU actions to their relevant status box IDs
    const kuActionBoxes = {
        "get_ku_properties": ["ku_side_a_dna", "ku_side_b_dna"],
        "program_ku": ["ku_program_side_a_status", "ku_program_side_b_status", "ku_program_side_a_id", "ku_program_side_b_id"],
        "program_ku_flash": ["ku_flash_side_a_status", "ku_flash_side_b_status", "ku_flash_side_a_id", "ku_flash_side_b_id"],
        "verify_ku_flash": ["ku_verify_side_a_status", "ku_verify_side_b_status", "ku_verify_side_a_id", "ku_verify_side_b_id"]
        
    };

    // Get all KU status boxes
    const allKUBoxes = [
        "ku_side_a_dna", "ku_side_b_dna",
        "ku_program_side_a_status", "ku_program_side_b_status", "ku_program_side_a_id", "ku_program_side_b_id",
        "ku_flash_side_a_status", "ku_flash_side_b_status", "ku_flash_side_a_id", "ku_flash_side_b_id",
        "ku_verify_side_a_status", "ku_verify_side_b_status", "ku_verify_side_a_id", "ku_verify_side_b_id"
    ];
    console.log(action);

    // Boxes relevant to clicked action
    const relevant = kuActionBoxes[action] || [];

    allKUBoxes.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        if (relevant.includes(id)) {
            el.innerText = "---";                      // reset text
            el.classList.add("status-active");         // green
            el.classList.remove("status-inactive");   // remove blue
        } else {
            el.classList.remove("status-active");     // remove green
            el.classList.add("status-inactive");      // light blue
        }
    });
}
function resetStatusBoxesForProasicAction(action) {
    // Map actions to their relevant status box IDs
    const actionBoxes = {
        "program_proasic": ["program_side_a_status", "program_side_b_status", "program_side_a_id", "program_side_b_id"],
        "verify_proasic": ["verify_side_a_status", "verify_side_b_status", "verify_side_a_id", "verify_side_b_id"],
        "get_proasic_info": ["proasic_side_a", "proasic_side_b"]
        // Add other actions here if needed
    };

    // Get all status boxes
    const allBoxes = [
        "program_side_a_status", "program_side_b_status",
        "verify_side_a_status", "verify_side_b_status",
        "proasic_side_a", "proasic_side_b"
    ];
    
    // Boxes relevant to clicked action
    const relevant = actionBoxes[action] || [];

    allBoxes.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        if (relevant.includes(id)) {
            el.innerText = "---";                      // reset text
            el.classList.add("status-active");         // green
            el.classList.remove("status-inactive");   // remove blue
        } else {
            el.classList.remove("status-active");     // remove green
            el.classList.add("status-inactive");      // light blue
        }
    });
}

function isUnsetStatusText(text) {
    const value = (text || "").trim();
    return !value || value === "---";
}

function isFailedStatusText(text) {
    const value = (text || "").trim().toUpperCase();
    return value === "FAILED!" || value === "FAILED" || value === "FAILURE";
}

function checkLedStatus(type) {
    const sides = ["a", "b"];
    let failed = false;
    let seen = 0;

    sides.forEach(side => {
        let statusId;

        if (type === "ku_program") statusId = `ku_program_side_${side}_status`;
        else if (type === "ku_flash_program") statusId = `ku_flash_side_${side}_status`;
        else if (type === "ku_verify") statusId = `ku_verify_side_${side}_status`;
        else if (type === "ku") statusId = `ku_side_${side}_dna`;

        else if (type === "proasic_program") statusId = `program_side_${side}_status`;
        else if (type === "proasic_verify") statusId = `verify_side_${side}_status`;
        else if (type === "proasic") statusId = `proasic_side_${side}`;

        if (!statusId) return;

        const span = document.getElementById(statusId);
        seen += 1;

        if (!span || isUnsetStatusText(span.innerText) || isFailedStatusText(span.innerText)) {
            failed = true;
        }
    });

    if (seen < 2) {
        failed = true;
    }

    return failed ? "failure" : "success";
}

function setButtonRunning(buttonId, isRunning) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    if (isRunning) {
        btn.classList.add("btn-running");
    } else {
        btn.classList.remove("btn-running");
    }
}

// ----------------------------
// Update DB info and check equality
// ----------------------------
function setKuSideDbInfo(side, serialNo, batchNo = null) {
    const sideKey = String(side).toLowerCase();
    const serialEl = document.getElementById(`ku_side_${sideKey}_serial`);
    const batchEl = document.getElementById(`ku_side_${sideKey}_batch`);
    if (!serialEl || !batchEl) {
        return;
    }

    if (serialNo === null || serialNo === undefined || serialNo === "") {
        serialEl.innerText = "---";
        batchEl.innerText = "---";
        return;
    }

    const serialText = String(serialNo);
    serialEl.innerText = serialText;

    if (batchNo !== null && batchNo !== undefined) {
        batchEl.innerText = String(batchNo);
    } else if (serialText === "Not in DB" || serialText === "---") {
        batchEl.innerText = "---";
    } else {
        batchEl.innerText = formatBatchNoFromSerial(serialText);
    }
}

function applyDbBoxAnimationState(box, state) {
    if (!box) {
        return;
    }

    box.classList.remove("blink-red", "green-text");
    // Force a reflow so CSS animations restart when the state changes.
    void box.offsetWidth;

    if (state === "ok") {
        box.classList.add("green-text");
    } else if (state === "error") {
        box.classList.add("blink-red");
    }
}

function styleKuDbBoxes() {
    const sideA = {
        serial: document.getElementById("ku_side_a_serial")?.innerText || "---",
        batch: document.getElementById("ku_side_a_batch")?.innerText || "---",
    };
    const sideB = {
        serial: document.getElementById("ku_side_b_serial")?.innerText || "---",
        batch: document.getElementById("ku_side_b_batch")?.innerText || "---",
    };

    const isUnset = value => !value || value === "---";
    const isMissing = value => isUnset(value) || value === "Not in DB";
    const equal = sideA.serial === sideB.serial && sideA.batch === sideB.batch;
    const valid = equal && !isMissing(sideA.serial);

    let stateA = "neutral";
    let stateB = "neutral";

    if (valid) {
        stateA = "ok";
        stateB = "ok";
    } else if (!isUnset(sideA.serial) || !isUnset(sideB.serial)) {
        // Any known mismatch / partial / unregistered state should blink.
        stateA = isMissing(sideA.serial) || !equal ? "error" : "ok";
        stateB = isMissing(sideB.serial) || !equal ? "error" : "ok";
        // Keep both blinking when the pair is inconsistent (original behavior).
        if (!equal) {
            stateA = "error";
            stateB = "error";
        }
    }

    applyDbBoxAnimationState(document.getElementById("db_side_a_box"), stateA);
    applyDbBoxAnimationState(document.getElementById("db_side_b_box"), stateB);

    return { equal, valid, sideA, sideB, stateA, stateB };
}

function syncKuDbBoxesFromDaughterboard(daughterboard, options = {}) {
    if (!daughterboard || !daughterboard.serial_no) {
        return;
    }

    const serialNo = daughterboard.serial_no;
    const batchNo = formatBatchNoFromSerial(serialNo);
    const programmer = getProgrammerDnas();
    const dbA = formatDnaForCompare(daughterboard.kintex_a_id);
    const dbB = formatDnaForCompare(daughterboard.kintex_b_id);
    const readA = formatDnaForCompare(programmer.dna_a);
    const readB = formatDnaForCompare(programmer.dna_b);

    const sides = options.sides
        ? options.sides.map(side => String(side).toLowerCase())
        : ["a", "b"];

    sides.forEach(side => {
        const readDna = side === "a" ? readA : readB;
        const matchesDb = Boolean(readDna) && (readDna === dbA || readDna === dbB);
        const force = options.force === true;
        if (force || matchesDb) {
            setKuSideDbInfo(side, serialNo, batchNo);
        }
    });

    styleKuDbBoxes();
}

function updateDbBoxes() {
    const { valid, sideA } = styleKuDbBoxes();

    if (valid) {
        refreshDaughterboardSectionFromSerial(sideA.serial);
    }
}

function setFpgaGroupButtonsDisabled(group, disabled, activeAction = null) {
    document.querySelectorAll(`.fpga-op-btn[data-group="${group}"]`).forEach(btn => {
        btn.disabled = Boolean(disabled);
        btn.classList.toggle("op-busy", Boolean(disabled));

        const isActiveButton = Boolean(
            activeAction
            && btn.getAttribute("onclick")
            && btn.getAttribute("onclick").includes(`'${activeAction}'`)
        );
        btn.classList.toggle("btn-running", Boolean(disabled) && isActiveButton);
    });
}

function getGroupConsole(group) {
    return document.getElementById(group === "ku" ? "ku_console" : "proasic_console");
}

function setGroupConsoleRunning(group, running) {
    const consoleDiv = getGroupConsole(group);
    if (!consoleDiv) {
        return;
    }

    consoleDiv.classList.toggle("is-running", Boolean(running));
    const wrapper = consoleDiv.closest(".right-console");
    if (wrapper) {
        wrapper.classList.toggle("is-running", Boolean(running));
    }
}

async function startAction(action, type) {
    lockAllEditModes(true);

    // Update HW status before starting
    await updateDetectedHW();

    let group = null;

    if (type.includes("proasic")) {
        resetStatusBoxesForProasicAction(action); // ✅ resets only relevant boxes
    }

    if (type.includes("ku")) {
        resetDbBoxes();
        resetStatusBoxesForKUAction(action);
    }

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

    setFpgaGroupButtonsDisabled(group, true, action);
    setGroupConsoleRunning(group, true);

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


    activeEventSources[group] = new EventSource("run/" + action);
    const eventSource = activeEventSources[group];
    let groupOperationFinished = false;

    const finishGroupOperation = (ledStatus) => {
        if (groupOperationFinished) {
            return;
        }
        groupOperationFinished = true;

        finishLED(led, ledStatus);
        eventSource.close();
        activeEventSources[group] = null;

        if (activeTimers[action]) {
            clearInterval(activeTimers[action]);
            delete activeTimers[action];
        }

        setFpgaGroupButtonsDisabled(group, false);
        setGroupConsoleRunning(group, false);
    };

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

            if (data.daughterboard_status === "matched" && data.daughterboard) {
                renderDaughterboardData(data.daughterboard);
            } else if (data.daughterboard_status === "mismatch_serial") {
                setDaughterboardSectionState("error", data.line || "DNAs belong to different daughterboards.");
                setDaughterboardPlaceholderValues();
            }

            // ----------------------
            // Correct DB match
            // ----------------------
            if (data.db_status === "registered") {

                const side = data.side.toLowerCase();

                document.getElementById(`ku_side_${side}_serial`).innerText = data.serial_no;
                document.getElementById(`ku_side_${side}_batch`).innerText =
                    data.batch_no || formatBatchNoFromSerial(data.serial_no);

                updateDbBoxes();
            }

            // ----------------------
            // Side mismatch error
            // ----------------------
            else if (data.db_status === "side_mismatch") {

                const side = data.expected_side.toLowerCase();

                document.getElementById(`ku_side_${side}_serial`).innerText = data.serial_no;
                document.getElementById(`ku_side_${side}_batch`).innerText =
                    data.batch_no || formatBatchNoFromSerial(data.serial_no);

                styleKuDbBoxes();
            }

            // ----------------------
            // Not in DB
            // ----------------------
            else if (data.db_status === "unregistered") {

                const serialBoxA = document.getElementById("ku_side_a_serial");
                const serialBoxB = document.getElementById("ku_side_b_serial");
                const batchBoxA = document.getElementById("ku_side_a_batch");
                const batchBoxB = document.getElementById("ku_side_b_batch");

                if (serialBoxA.innerText === "---") {
                    serialBoxA.innerText = "Not in DB";
                    if (batchBoxA) batchBoxA.innerText = "---";
                }
                if (serialBoxB.innerText === "---") {
                    serialBoxB.innerText = "Not in DB";
                    if (batchBoxB) batchBoxB.innerText = "---";
                }

                styleKuDbBoxes();

                setDaughterboardSectionState("error", "One or both KU DNAs are not registered in the database.");
                setDaughterboardPlaceholderValues();
            }
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
            finishGroupOperation(checkLedStatus(type));
        }
    };

    eventSource.onerror = function() {
        finishGroupOperation(checkLedStatus(type));
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

        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.a.programmer.trim().toUpperCase())) {
            const span = document.getElementById("program_side_a_status");
            span.innerText = statusText;
            span.className = className;
        }

        if (programmer.trim().toUpperCase().includes(hwConfig.proasic.sides.b.programmer.trim().toUpperCase())) {
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

    refreshDaughterboardSectionFromDnas();
    updateDaughterboardReadoutDnas();
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




// Update CPU/RAM every 5 seconds
async function updateSystemUsage() {
    try {
        const res = await fetch("api/system_usage");
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
    // ✅ Confirmation dialog
    if (!confirm("Are you sure you want to refresh processes? This will kill running processes.")) {
        return;
    }

    const btn = document.getElementById("refresh-processes");

    btn.disabled = true;
    btn.innerText = "Refreshing...";

    try {
        const res = await fetch("api/refresh_processes", { method: "POST" });
        const data = await res.json();

        alert("Processes refreshed: " + (data.killed.length ? data.killed.join(", ") : "None"));

    } catch (err) {
        console.error(err);
        alert("Failed to refresh processes.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Refresh Processes";
    }
});

document.getElementById("restart-tile-wjtag").addEventListener("click", () => {
    // ✅ Confirmation dialog
    if (!confirm("Are you sure you want to restart the tile-wjtag service?")) {
        return;
    }

    const btn = document.getElementById("restart-tile-wjtag");

    btn.disabled = true;
    btn.innerText = "Restarting...";

    // 🔥 Fire-and-forget (DO NOT await)
    fetch("api/restart_tile_wjtag", {
        method: "POST"
    }).catch(err => {
        console.log("Expected error during restart:", err);
    });

    // 💡 Replace UI with reconnect message
    document.body.innerHTML = `
        <div style="text-align:center; margin-top:50px;">
            <h2>Restarting service...</h2>
            <p>Reconnecting, please wait.</p>
        </div>
    `;

    // 🚀 Retry until backend is back
    function waitForServer() {
        fetch("/api/get_hostname")
            .then(() => {
                location.reload();
            })
            .catch(() => {
                setTimeout(waitForServer, 1000);
            });
    }

    // ⏳ Give backend a moment before starting retries
    setTimeout(waitForServer, 3000);
});

function setPowerButton(side, state) {
    const btn = document.getElementById(`power_${side}_btn`);
    if (!btn) return;

    if (state === "on") {
        btn.classList.remove("off");
        btn.classList.add("on");
        btn.innerText = "ON";
    } else {
        btn.classList.remove("on");
        btn.classList.add("off");
        btn.innerText = "OFF";
    }
}

async function updatePowerStates() {
    try {
        const res = await fetch("api/power_states");
        const data = await res.json();

        for (const [side, state] of Object.entries(data.states || {})) {
            setPowerButton(side, state);
        }
    } catch (err) {
        console.error("Failed to fetch power states:", err);
    }
}

async function togglePower(side) {
    await fetch(`api/power_toggle/${side}`, { method: "POST" });
    setTimeout(() => updatePowerStates(), 500);
}

document.getElementById("power_a_btn").addEventListener("click", () => {
    togglePower("a");
});


document.getElementById("power_b_btn").addEventListener("click", () => {
    togglePower("b");
});

// Auto refresh every 5 seconds
setInterval(updatePowerStates, 5000);

// Initial load
updatePowerStates();
