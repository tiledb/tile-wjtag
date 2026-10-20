// Global variables
let hwConfig = null;      // Your existing config
let hwDetected = null;    // Detected hardware (Digilent + FlashPro)
let hostRegistered = false;
let stationHostname = "";
let stationTools = { vivado: { available: false }, fpexpress: { available: false } };
let knownHosts = [];
let hostFields = {};
let operationBusyGroups = { ku: false, proasic: false };

async function loadHwConfig() {
    try {
        const [bootstrapResponse, detectedResponse] = await Promise.all([
            fetch("api/bootstrap"),
            fetch("api/detect_programmers"),
        ]);

        const bootstrap = await bootstrapResponse.json();
        if (!bootstrapResponse.ok) {
            throw new Error(bootstrap.error || "failed to load bootstrap");
        }

        applyStationBootstrap(bootstrap);
        hwDetected = await detectedResponse.json();

        document.getElementById("hostname-value").textContent = stationHostname || "Unknown";
        console.log("Loaded HW config:", hwConfig);
        console.log("Detected hardware from server:", hwDetected);
        console.log("Host registered:", hostRegistered, "tools:", stationTools);

        initializeUI();
        updateStationGates();
        updateOperationAvailability();
    } catch (error) {
        console.error("Failed to load hardware or detected devices:", error);
        document.getElementById("hostname-value").textContent = "Unknown";
        hostRegistered = false;
        updateStationGates();
        updateOperationAvailability();
    }
}

function applyStationBootstrap(bootstrap) {
    stationHostname = bootstrap.hostname || "";
    hostRegistered = bootstrap.host_registered === true;
    knownHosts = Array.isArray(bootstrap.known_hosts) ? bootstrap.known_hosts : [];
    stationTools = bootstrap.tools || stationTools;
    hostFields = bootstrap.host_fields || {};
    if (bootstrap.hw_config) {
        hwConfig = bootstrap.hw_config;
    } else if (hostRegistered === false) {
        // Unregistered: keep a stub so the rest of the UI does not crash.
        hwConfig = hwConfig || {
            ku: { jtag_freq_hz: 15000000, sides: { a: { serial: "" }, b: { serial: "" } } },
            proasic: { sides: { a: { programmer: "" }, b: { programmer: "" } } },
            ha_power_control: { sides: { a: "", b: "" } },
        };
    }
}

function isVivadoAvailable() {
    return stationTools?.vivado?.available === true;
}

function isFpExpressAvailable() {
    return stationTools?.fpexpress?.available === true;
}

function canRunKuOps() {
    return (
        hostRegistered
        && hasAnyKuSideRegistered()
        && isVivadoAvailable()
        && !operationBusyGroups.ku
    );
}

function canRunProasicOps() {
    return (
        hostRegistered
        && hasAnyProasicSideRegistered()
        && isFpExpressAvailable()
        && !operationBusyGroups.proasic
    );
}

function updateStationGates() {
    const banner = document.getElementById("station-gates-banner");
    const title = document.getElementById("station-gates-title");
    const detail = document.getElementById("station-gates-detail");
    const toolsLine = document.getElementById("station-tools-line");
    const badge = document.getElementById("host-reg-badge");
    const opsStack = document.querySelector(".operations-stack");

    if (badge) {
        badge.hidden = false;
        badge.textContent = hostRegistered ? "registered" : "unregistered";
        badge.classList.toggle("is-registered", hostRegistered);
        badge.classList.toggle("is-unregistered", !hostRegistered);
    }

    if (opsStack) {
        opsStack.classList.toggle("is-host-locked", !hostRegistered);
    }

    const vivadoOk = isVivadoAvailable();
    const fpOk = isFpExpressAvailable();
    const issues = [];

    if (!hostRegistered) {
        issues.push(
            `Host "${stationHostname || "?"}" is not in hw_config.json. ` +
            "Unlock Global → Advanced options → Register this host."
        );
    }
    if (hostRegistered && !hasAnyKuSideRegistered()) {
        issues.push("No KU cable serial registered — KU ops disabled (leave blank = Not Registered).");
    }
    if (hostRegistered && !hasAnyProasicSideRegistered()) {
        issues.push("No ProASIC programmer registered — ProASIC ops disabled.");
    }
    if (!vivadoOk) {
        issues.push("Vivado Lab not found — KU operation buttons stay disabled.");
    }
    if (!fpOk) {
        issues.push("FPExpress not found — ProASIC operation buttons stay disabled.");
    }

    if (banner && title && detail && toolsLine) {
        if (issues.length) {
            banner.hidden = false;
            banner.classList.toggle("is-error", !hostRegistered);
            banner.classList.toggle("is-ok", false);
            title.textContent = !hostRegistered
                ? "Host not registered — station locked"
                : (issues.some(i => i.includes("not found"))
                    ? "Some tools or sides are unavailable"
                    : "Some sides are not registered");
            detail.textContent = issues.join(" ");
        } else {
            banner.hidden = true;
        }
        const v = stationTools?.vivado || {};
        const f = stationTools?.fpexpress || {};
        toolsLine.textContent =
            `Tools: Vivado ${vivadoOk ? "OK" : "missing"}` +
            `${v.binary ? ` (${v.binary})` : ""} · ` +
            `FPExpress ${fpOk ? "OK" : "missing"}` +
            `${f.path ? ` (${f.path})` : ""}`;
    }

    renderToolPills();
}

function renderToolPills() {
    const vivadoEl = document.getElementById("ku-tools-vivado");
    const fpEl = document.getElementById("ku-tools-fpexpress");
    const vivadoOk = isVivadoAvailable();
    const fpOk = isFpExpressAvailable();

    if (vivadoEl) {
        vivadoEl.textContent = `Vivado: ${vivadoOk ? "available" : "missing"}`;
        vivadoEl.classList.toggle("is-ok", vivadoOk);
        vivadoEl.classList.toggle("is-missing", !vivadoOk);
        vivadoEl.title = stationTools?.vivado?.binary || "";
    }
    if (fpEl) {
        fpEl.textContent = `FPExpress: ${fpOk ? "available" : "missing"}`;
        fpEl.classList.toggle("is-ok", fpOk);
        fpEl.classList.toggle("is-missing", !fpOk);
        fpEl.title = stationTools?.fpexpress?.path || "";
    }
}

function updateOperationAvailability() {
    const kuEnabled = canRunKuOps();
    const proEnabled = canRunProasicOps();

    document.querySelectorAll('.fpga-op-btn[data-group="ku"]').forEach(btn => {
        const forceBusy = operationBusyGroups.ku;
        const gated = !hostRegistered || !isVivadoAvailable() || !hasAnyKuSideRegistered();
        btn.disabled = forceBusy || !kuEnabled;
        btn.classList.toggle("is-gated", gated);
        if (!forceBusy) {
            btn.classList.remove("op-busy", "btn-running");
        }
        btn.title = !hostRegistered
            ? "Register this host in Advanced options first"
            : (!hasAnyKuSideRegistered()
                ? "No KU side registered — set a cable serial in Advanced options"
                : (!isVivadoAvailable() ? "Vivado Lab is not available on this host" : ""));
    });

    document.querySelectorAll('.fpga-op-btn[data-group="proasic"]').forEach(btn => {
        const forceBusy = operationBusyGroups.proasic;
        const gated = !hostRegistered || !isFpExpressAvailable() || !hasAnyProasicSideRegistered();
        btn.disabled = forceBusy || !proEnabled;
        btn.classList.toggle("is-gated", gated);
        if (!forceBusy) {
            btn.classList.remove("op-busy", "btn-running");
        }
        btn.title = !hostRegistered
            ? "Register this host in Advanced options first"
            : (!hasAnyProasicSideRegistered()
                ? "No ProASIC side registered — set a programmer ID in Advanced options"
                : (!isFpExpressAvailable() ? "FPExpress is not available on this host" : ""));
    });

    ["a", "b"].forEach(side => {
        const btn = document.getElementById(`power_${side}_btn`);
        if (!btn) {
            return;
        }
        const haOk = isHaSideRegistered(side);
        const gated = !hostRegistered || !haOk;
        btn.disabled = gated;
        btn.classList.toggle("is-gated", gated);
        if (!hostRegistered) {
            btn.title = "Register this host before using power control";
        } else if (!haOk) {
            btn.title = `HA entity for side ${side.toUpperCase()} ${NOT_REGISTERED_LABEL}`;
            if (!btn.dataset.powerLabel) {
                btn.dataset.powerLabel = btn.innerText || "OFF";
            }
            btn.innerText = "N/A";
        } else {
            btn.title = "";
            if (btn.innerText === "N/A" && btn.dataset.powerLabel) {
                btn.innerText = btn.dataset.powerLabel;
            }
        }
    });

    updateSideRegistrationLabels();
}

function updateSideRegistrationLabels() {
    updateKuProgrammerBoxes();

    const proABox = document.getElementById("proasic_side_a_box");
    const proBBox = document.getElementById("proasic_side_b_box");
    if (proABox) {
        proABox.innerText = `A: ${formatProasicSideLabel("a")}`;
        proABox.classList.toggle("is-not-registered", !isProasicSideRegistered("a"));
    }
    if (proBBox) {
        proBBox.innerText = `B: ${formatProasicSideLabel("b")}`;
        proBBox.classList.toggle("is-not-registered", !isProasicSideRegistered("b"));
    }
}

async function updateDetectedHW() {
    if (!hwConfig || !hostRegistered) return;

    try {
        const response = await fetch("api/detect_programmers");
        hwDetected = await response.json();
        updateSideRegistrationLabels();

        const detectedKU = hwDetected?.digilent?.map(dev => dev.serial) || [];
        const kuABox = document.getElementById("ku_side_a_prog");
        const kuBBox = document.getElementById("ku_side_b_prog");
        const serialA = getKuSideSerial("a");
        const serialB = getKuSideSerial("b");

        if (kuABox) {
            kuABox.classList.toggle(
                "blink-red",
                isKuSideEnabled("a") && Boolean(serialA) && !detectedKU.includes(serialA)
            );
        }
        if (kuBBox) {
            kuBBox.classList.toggle(
                "blink-red",
                isKuSideEnabled("b") && Boolean(serialB) && !detectedKU.includes(serialB)
            );
        }

        const proABox = document.getElementById("proasic_side_a_box");
        const proBBox = document.getElementById("proasic_side_b_box");
        const detectedPro = hwDetected?.flashpro?.map(dev => dev.serial) || [];
        const progA = getProasicProgrammer("a");
        const progB = getProasicProgrammer("b");

        if (proABox) {
            proABox.classList.toggle(
                "blink-red",
                isProasicSideRegistered("a") && Boolean(progA) && !detectedPro.includes(progA)
            );
        }
        if (proBBox) {
            proBBox.classList.toggle(
                "blink-red",
                isProasicSideRegistered("b") && Boolean(progB) && !detectedPro.includes(progB)
            );
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

    // KU serial -> side map (honors session cable overrides)
    rebuildKuRuntimeMaps();

    // ProASIC programmer -> side map
    window.proasicProgToSide = {};
    Object.entries(hwConfig?.proasic?.sides || {}).forEach(([side, data]) => {
        if (data?.programmer) {
            proasicProgToSide[data.programmer] = side;
        }
    });

    console.log("KU serial map:", kuSerialToSide);
    console.log("ProASIC programmer map:", proasicProgToSide);
    console.log("KU regex ready.");

    // ----------------------------------
    // Optional: Show config info in UI
    // ----------------------------------

    const kuInfo = document.getElementById("ku_config_info");
    if (kuInfo) {
        kuInfo.innerText = Object.entries(hwConfig?.ku?.sides || {})
            .map(([side, d]) => `Side ${side.toUpperCase()}: ${d.serial || "—"}`)
            .join(" | ");
    }

    const proasicInfo = document.getElementById("proasic_config_info");
    if (proasicInfo) {
        proasicInfo.innerText = Object.entries(hwConfig?.proasic?.sides || {})
            .map(([side, d]) => `Side ${side.toUpperCase()}: ${d.programmer || "—"}`)
            .join(" | ");
    }


    // ------------------
    // KU Boxes
    // ------------------
    updateSideRegistrationLabels();

    const detectedKU = (hwDetected?.digilent || []).map(dev => dev.serial);
    const kuABox = document.getElementById("ku_side_a_prog");
    const kuBBox = document.getElementById("ku_side_b_prog");
    const serialA = getKuSideSerial("a");
    const serialB = getKuSideSerial("b");

    if (kuABox) {
        kuABox.classList.toggle(
            "blink-red",
            isKuSideEnabled("a") && Boolean(serialA) && !detectedKU.includes(serialA)
        );
    }
    if (kuBBox) {
        kuBBox.classList.toggle(
            "blink-red",
            isKuSideEnabled("b") && Boolean(serialB) && !detectedKU.includes(serialB)
        );
    }

    const proABox = document.getElementById("proasic_side_a_box");
    const proBBox = document.getElementById("proasic_side_b_box");
    const progA = getProasicProgrammer("a");
    const progB = getProasicProgrammer("b");
    const detectedPro = (hwDetected?.flashpro || []).map(dev => dev.serial);

    if (proABox) {
        proABox.classList.toggle(
            "blink-red",
            isProasicSideRegistered("a") && Boolean(progA) && !detectedPro.includes(progA)
        );
    }
    if (proBBox) {
        proBBox.classList.toggle(
            "blink-red",
            isProasicSideRegistered("b") && Boolean(progB) && !detectedPro.includes(progB)
        );
    }

    updateOperationAvailability();
    console.log("UI initialized successfully.");
}



document.addEventListener("DOMContentLoaded", () => {
    initDaughterboardGrid();
    resetDaughterboardSection();
    loadComponentLots();
    loadHwConfig();
    initEditIdleTracking();
    initDnaChoiceModal();
    initKuFirmwareControls();
    loadKuFirmwareSets();
    initKuAdvancedOptions();
    loadKuAdvancedOptions();
});


// ----------------------------
// Runtime state
// ----------------------------
let activeEventSources = {
    ku: null,
    proasic: null
};

let activeTimers = {}; // keep track of running timers
let kuFirmwareSets = [];
let kuFirmwareDetails = {};
let kuFirmwareActive = null;
let kuFirmwareSelectSuppress = false;
let typeConfirmResolver = null;

// Session-only KU cable overrides (null = use hw_config default). Reset on refresh.
let kuSessionCableOverrides = { a: null, b: null };
// Session-only which sides participate in KU ops. Default both on; reset on refresh.
let kuSessionCableEnabled = { a: true, b: true };
let kuDiscoveredCables = [];
let kuJtagFreqChoices = [];
let kuAdvancedWired = false;
let kuHwConfigFileText = "";
let kuHwConfigFileEditing = false;
let kuHwConfigFilePath = "";
let kuJtagFreqSuppress = false;
let kuGitCommits = [];
let kuGitBusy = false;
let kuGitWired = false;
let kuCableSelectSuppress = false;
let kuCableEnableSuppress = false;

const NOT_REGISTERED_LABEL = "(Not Registered)";

function getKuDefaultSerial(side) {
    return (hwConfig?.ku?.sides?.[side]?.serial || "").trim();
}

function getProasicProgrammer(side) {
    return (hwConfig?.proasic?.sides?.[side]?.programmer || "").trim();
}

function getHaEntity(side) {
    return (hwConfig?.ha_power_control?.sides?.[side] || "").trim();
}

/** Persistent host-config registration (empty field = not registered). */
function isKuSideRegistered(side) {
    return Boolean(getKuDefaultSerial(side));
}

function isProasicSideRegistered(side) {
    return Boolean(getProasicProgrammer(side));
}

function isHaSideRegistered(side) {
    return Boolean(getHaEntity(side));
}

function hasAnyKuSideRegistered() {
    return isKuSideRegistered("a") || isKuSideRegistered("b");
}

function hasAnyProasicSideRegistered() {
    return isProasicSideRegistered("a") || isProasicSideRegistered("b");
}

function getKuSideSerial(side) {
    if (!isKuSideRegistered(side)) {
        return "";
    }
    const override = kuSessionCableOverrides[side];
    if (override) {
        return override;
    }
    return getKuDefaultSerial(side);
}

function isKuSideEnabled(side) {
    // Unregistered sides cannot participate in KU ops.
    if (!isKuSideRegistered(side)) {
        return false;
    }
    return kuSessionCableEnabled[side] !== false;
}

function getKuEnabledSides() {
    return ["a", "b"].filter(isKuSideEnabled);
}

function formatKuSideLabel(side) {
    if (!isKuSideRegistered(side)) {
        return NOT_REGISTERED_LABEL;
    }
    const serial = getKuSideSerial(side) || "---";
    return isKuSideEnabled(side) ? serial : `${serial} (off)`;
}

function formatProasicSideLabel(side) {
    if (!isProasicSideRegistered(side)) {
        return NOT_REGISTERED_LABEL;
    }
    return getProasicProgrammer(side);
}

function rebuildKuRuntimeMaps() {
    if (!hwConfig?.ku?.sides) {
        return;
    }

    window.kuSerialToSide = {};
    getKuEnabledSides().forEach(side => {
        const serial = getKuSideSerial(side);
        if (serial) {
            kuSerialToSide[serial] = side;
        }
    });

    const kuSerials = getKuEnabledSides().map(getKuSideSerial).filter(Boolean).join("|") || "___NO_SERIAL___";
    window.kuDnaRegex = new RegExp(
        `\\((${kuSerials})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`,
        "i"
    );
    window.kuResultRegex = new RegExp(
        `\\((${kuSerials})\\)\\s+Tile Operation\\s+(Success|Failure)!`,
        "i"
    );
}

function formatJtagFreqLabel(hz) {
    const value = Number(hz) || 0;
    if (value >= 1_000_000 && value % 1_000_000 === 0) {
        return `${value / 1_000_000} MHz`;
    }
    if (value >= 1000 && value % 1000 === 0) {
        return `${value / 1000} kHz`;
    }
    return `${value} Hz`;
}

function setKuAdvancedStatus(message, isError = false) {
    const el = document.getElementById("ku-advanced-status");
    if (!el) {
        return;
    }
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError && message));
}

function setKuGitStatus(message, isError = false) {
    const el = document.getElementById("ku-git-status");
    if (!el) {
        return;
    }
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError && message));
}

function updateKuProgrammerBoxes() {
    const kuABox = document.getElementById("ku_side_a_prog");
    const kuBBox = document.getElementById("ku_side_b_prog");
    if (!kuABox || !kuBBox) {
        return;
    }

    const serialA = getKuSideSerial("a");
    const serialB = getKuSideSerial("b");
    kuABox.innerText = formatKuSideLabel("a");
    kuBBox.innerText = formatKuSideLabel("b");
    kuABox.classList.toggle("is-not-registered", !isKuSideRegistered("a"));
    kuBBox.classList.toggle("is-not-registered", !isKuSideRegistered("b"));

    const parentA = kuABox.closest(".id-box") || kuABox.parentElement;
    const parentB = kuBBox.closest(".id-box") || kuBBox.parentElement;
    const detectedKU = (hwDetected?.digilent || []).map(dev => dev.serial);
    if (parentA) {
        parentA.classList.toggle(
            "blink-red",
            isKuSideEnabled("a") && Boolean(serialA) && !detectedKU.includes(serialA)
        );
        parentA.classList.toggle("is-not-registered", !isKuSideRegistered("a"));
    }
    if (parentB) {
        parentB.classList.toggle(
            "blink-red",
            isKuSideEnabled("b") && Boolean(serialB) && !detectedKU.includes(serialB)
        );
        parentB.classList.toggle("is-not-registered", !isKuSideRegistered("b"));
    }
}

function exitKuHwConfigFileEdit(reloadText = true) {
    kuHwConfigFileEditing = false;
    const editor = document.getElementById("ku-hw-config-editor");
    if (editor && reloadText) {
        editor.value = kuHwConfigFileText;
    }
    updateKuAdvancedControls();
}

function isKuAdvancedModalOpen() {
    const modal = document.getElementById("ku-advanced-modal");
    return Boolean(modal && !modal.hidden);
}

function isKuGitModalOpen() {
    const modal = document.getElementById("ku-git-modal");
    return Boolean(modal && !modal.hidden);
}

function closeKuAdvancedModal() {
    const modal = document.getElementById("ku-advanced-modal");
    if (modal) {
        modal.hidden = true;
    }
    if (kuHwConfigFileEditing) {
        exitKuHwConfigFileEdit(true);
    }
}

function closeKuGitModal() {
    const modal = document.getElementById("ku-git-modal");
    if (modal) {
        modal.hidden = true;
    }
}

async function openKuAdvancedModal() {
    if (!globalEditUnlocked) {
        return;
    }
    const modal = document.getElementById("ku-advanced-modal");
    if (!modal) {
        return;
    }
    closeKuGitModal();
    setKuAdvancedStatus("");
    await loadKuAdvancedOptions();
    modal.hidden = false;
    updateKuAdvancedControls();
}

async function openKuGitModal() {
    if (!globalEditUnlocked) {
        return;
    }
    const modal = document.getElementById("ku-git-modal");
    if (!modal) {
        return;
    }
    closeKuAdvancedModal();
    setKuGitStatus("");
    modal.hidden = false;
    updateKuAdvancedControls();
    await loadKuGitManager({ fetchRemote: true });
}

function syncKuCableEnableCheckboxes() {
    const enableA = document.getElementById("ku-cable-a-enable");
    const enableB = document.getElementById("ku-cable-b-enable");
    const cableA = document.getElementById("ku-cable-a-select");
    const cableB = document.getElementById("ku-cable-b-select");
    const unlocked = globalEditUnlocked === true;

    kuCableEnableSuppress = true;
    if (enableA) {
        enableA.checked = isKuSideEnabled("a");
        enableA.disabled = !unlocked || !isKuSideRegistered("a");
        enableA.title = isKuSideRegistered("a") ? "" : `Side A ${NOT_REGISTERED_LABEL}`;
    }
    if (enableB) {
        enableB.checked = isKuSideEnabled("b");
        enableB.disabled = !unlocked || !isKuSideRegistered("b");
        enableB.title = isKuSideRegistered("b") ? "" : `Side B ${NOT_REGISTERED_LABEL}`;
    }
    kuCableEnableSuppress = false;

    if (cableA) {
        cableA.disabled = !unlocked || !isKuSideEnabled("a");
        cableA.classList.toggle("is-cable-disabled", !isKuSideEnabled("a"));
    }
    if (cableB) {
        cableB.disabled = !unlocked || !isKuSideEnabled("b");
        cableB.classList.toggle("is-cable-disabled", !isKuSideEnabled("b"));
    }
}

function applyKuCableEnabled(side, enabled) {
    if (!isKuSideRegistered(side)) {
        syncKuCableEnableCheckboxes();
        setKuAdvancedStatus(`Cable ${side.toUpperCase()} ${NOT_REGISTERED_LABEL}`, true);
        return false;
    }

    const next = Boolean(enabled);
    const other = side === "a" ? "b" : "a";
    if (!next && !isKuSideEnabled(other)) {
        syncKuCableEnableCheckboxes();
        setKuAdvancedStatus("At least one registered cable must stay enabled", true);
        return false;
    }

    kuSessionCableEnabled[side] = next;
    rebuildKuRuntimeMaps();
    updateKuProgrammerBoxes();
    syncKuCableEnableCheckboxes();
    setKuAdvancedStatus(
        next
            ? `Cable ${side.toUpperCase()} enabled (session only)`
            : `Cable ${side.toUpperCase()} disabled for this session`
    );
    return true;
}

async function forceDefaultKuSessionOptions() {
    if (!globalEditUnlocked) {
        return;
    }

    const confirmed = await askTypeConfirm({
        title: "Force session defaults",
        message:
            "ARE YOU SURE?\n\n" +
            "This restores non-persistent Advanced options:\n" +
            "- Cable A/B selection → hw_config defaults\n" +
            "- Cable enable checkboxes → registered sides enabled\n\n" +
            "Unregistered sides stay (Not Registered).\n" +
            "JTAG speed and hw_config.json are not changed.",
        phrase: "CHANGE",
        irreversible: false,
    });
    if (!confirmed) {
        return;
    }

    kuSessionCableOverrides = { a: null, b: null };
    kuSessionCableEnabled = {
        a: isKuSideRegistered("a"),
        b: isKuSideRegistered("b"),
    };
    rebuildKuRuntimeMaps();
    updateKuProgrammerBoxes();
    renderKuCableSelects();
    syncKuCableEnableCheckboxes();
    updateKuAdvancedControls();
    setKuAdvancedStatus("Session options restored to defaults (registered cables enabled)");
}

function updateKuAdvancedControls() {
    const unlocked = globalEditUnlocked === true;
    const registered = hostRegistered === true;
    const settingsBtn = document.getElementById("ku-advanced-settings-btn");
    const gitBtn = document.getElementById("ku-git-settings-btn");
    const freqSelect = document.getElementById("ku-jtag-freq-select");
    const enableA = document.getElementById("ku-cable-a-enable");
    const enableB = document.getElementById("ku-cable-b-enable");
    const refreshBtn = document.getElementById("ku-cables-refresh-btn");
    const defaultsBtn = document.getElementById("ku-session-defaults-btn");
    const editBtn = document.getElementById("ku-hw-config-edit-btn");
    const saveBtn = document.getElementById("ku-hw-config-save-btn");
    const cancelBtn = document.getElementById("ku-hw-config-cancel-btn");
    const editor = document.getElementById("ku-hw-config-editor");
    const restartHwserverBtn = document.getElementById("ku-restart-hwserver-btn");
    const restartTileBtn = document.getElementById("ku-restart-tile-wjtag-btn");
    const procRefreshBtn = document.getElementById("ku-proc-refresh-btn");
    const gitRefreshBtn = document.getElementById("ku-git-refresh-btn");
    const gitUpdateBtn = document.getElementById("ku-git-update-btn");
    const gitRestartBtn = document.getElementById("ku-git-restart-btn");
    const gitSelect = document.getElementById("ku-git-commit-select");
    const hostRegStatus = document.getElementById("ku-host-reg-status");
    const hostCloneSelect = document.getElementById("ku-host-clone-select");
    const hostRegisterBtn = document.getElementById("ku-host-register-btn");
    const hostSaveBtn = document.getElementById("ku-host-save-fields-btn");
    const toolsRefreshBtn = document.getElementById("ku-tools-refresh-btn");
    const hostFieldIds = [
        "ku-host-serial-a", "ku-host-serial-b",
        "ku-host-proasic-a", "ku-host-proasic-b",
        "ku-host-ha-a", "ku-host-ha-b",
        "ku-host-hwserver-a", "ku-host-hwserver-b",
    ];

    // Advanced gear is always reachable when Global is unlocked — needed to register a new host.
    if (settingsBtn) {
        settingsBtn.hidden = !unlocked;
        settingsBtn.disabled = !unlocked;
    }
    if (gitBtn) {
        gitBtn.hidden = !unlocked || !registered;
        gitBtn.disabled = !unlocked || !registered;
    }

    if (!unlocked) {
        if (isKuAdvancedModalOpen()) {
            closeKuAdvancedModal();
        } else if (kuHwConfigFileEditing) {
            exitKuHwConfigFileEdit(true);
        }
        if (isKuGitModalOpen()) {
            closeKuGitModal();
        }
    }

    if (hostRegStatus) {
        hostRegStatus.textContent = registered
            ? `${stationHostname} — registered`
            : `${stationHostname || "?"} — NOT registered`;
    }

    if (hostCloneSelect) {
        const previous = hostCloneSelect.value;
        hostCloneSelect.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "Blank defaults";
        hostCloneSelect.appendChild(blank);
        knownHosts
            .filter(h => h !== stationHostname)
            .forEach(h => {
                const opt = document.createElement("option");
                opt.value = h;
                opt.textContent = h;
                hostCloneSelect.appendChild(opt);
            });
        if ([...hostCloneSelect.options].some(o => o.value === previous)) {
            hostCloneSelect.value = previous;
        }
        hostCloneSelect.disabled = !unlocked || registered;
    }
    if (hostRegisterBtn) {
        hostRegisterBtn.disabled = !unlocked || registered;
        hostRegisterBtn.hidden = registered;
        hostRegisterBtn.textContent = registered ? "Host registered" : "Register this host";
    }
    const registerRow = document.getElementById("ku-host-register-row");
    if (registerRow) {
        registerRow.hidden = registered;
    }

    hostFieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !unlocked;
        }
    });
    if (hostSaveBtn) {
        hostSaveBtn.disabled = !unlocked || !registered;
        hostSaveBtn.title = registered
            ? "Save structured host options to hw_config.json"
            : "Register the host first, then save options";
    }
    if (toolsRefreshBtn) {
        toolsRefreshBtn.disabled = !unlocked;
    }
    renderToolPills();

    // Session / service controls require a registered host.
    const hostReady = unlocked && registered;
    if (freqSelect) freqSelect.disabled = !hostReady;
    if (enableA) enableA.disabled = !hostReady;
    if (enableB) enableB.disabled = !hostReady;
    // Cable scan only needs Vivado — useful while registering host serials.
    if (refreshBtn) {
        refreshBtn.disabled = !unlocked || !isVivadoAvailable();
        refreshBtn.title = !isVivadoAvailable()
            ? "Vivado Lab is not available"
            : "Scan Digilent cables via Vivado (fills blank KU serial fields)";
    }
    if (defaultsBtn) defaultsBtn.disabled = !hostReady;
    if (restartHwserverBtn) restartHwserverBtn.disabled = !unlocked;
    if (restartTileBtn) restartTileBtn.disabled = !unlocked;
    if (procRefreshBtn) procRefreshBtn.disabled = !unlocked;
    document.querySelectorAll(".ku-kill-proc-btn").forEach(btn => {
        btn.disabled = !unlocked;
    });
    syncKuCableEnableCheckboxes();

    if (editBtn) {
        editBtn.disabled = !unlocked || kuHwConfigFileEditing;
        editBtn.hidden = kuHwConfigFileEditing;
    }
    if (saveBtn) {
        saveBtn.hidden = !kuHwConfigFileEditing;
        saveBtn.disabled = !unlocked || !kuHwConfigFileEditing;
    }
    if (cancelBtn) {
        cancelBtn.hidden = !kuHwConfigFileEditing;
        cancelBtn.disabled = !unlocked || !kuHwConfigFileEditing;
    }
    if (editor) {
        editor.readOnly = !kuHwConfigFileEditing;
        editor.disabled = !unlocked;
        editor.classList.toggle("is-editing", kuHwConfigFileEditing);
    }

    const gitReady = unlocked && registered && !kuGitBusy;
    if (gitRefreshBtn) gitRefreshBtn.disabled = !gitReady;
    if (gitSelect) gitSelect.disabled = !gitReady;
    if (gitRestartBtn) gitRestartBtn.disabled = !gitReady;
    if (gitUpdateBtn) {
        gitUpdateBtn.disabled = !gitReady || !(gitSelect && gitSelect.value);
    }
}

function fillHostFieldsForm(fields) {
    const map = {
        "ku-host-proasic-a": fields.proasic_programmer_a,
        "ku-host-proasic-b": fields.proasic_programmer_b,
        "ku-host-ha-a": fields.ha_entity_a,
        "ku-host-ha-b": fields.ha_entity_b,
        "ku-host-hwserver-a": fields.ku_hw_server_a,
        "ku-host-hwserver-b": fields.ku_hw_server_b,
    };
    Object.entries(map).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = value || "";
        }
    });

    // Seed KU serial selects so saved values survive option rebuild.
    ["a", "b"].forEach(side => {
        const pick = document.getElementById(`ku-host-serial-${side}`);
        const serial = (fields[`ku_serial_${side}`] || "").trim();
        if (!pick) {
            return;
        }
        pick.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "(Not Registered)";
        pick.appendChild(blank);
        if (serial) {
            const opt = document.createElement("option");
            opt.value = serial;
            opt.textContent = serial;
            pick.appendChild(opt);
            pick.value = serial;
        }
    });
    renderKuHostSerialPickers();
}

function collectHostFieldsForm() {
    return {
        ku_serial_a: document.getElementById("ku-host-serial-a")?.value?.trim() || "",
        ku_serial_b: document.getElementById("ku-host-serial-b")?.value?.trim() || "",
        proasic_programmer_a: document.getElementById("ku-host-proasic-a")?.value?.trim() || "",
        proasic_programmer_b: document.getElementById("ku-host-proasic-b")?.value?.trim() || "",
        ha_entity_a: document.getElementById("ku-host-ha-a")?.value?.trim() || "",
        ha_entity_b: document.getElementById("ku-host-ha-b")?.value?.trim() || "",
        ku_hw_server_a: document.getElementById("ku-host-hwserver-a")?.value?.trim() || "localhost:3121",
        ku_hw_server_b: document.getElementById("ku-host-hwserver-b")?.value?.trim() || "localhost:3121",
        jtag_freq_hz: Number(document.getElementById("ku-jtag-freq-select")?.value) || hostFields.jtag_freq_hz || 15000000,
    };
}

async function registerCurrentHost() {
    if (!globalEditUnlocked) {
        return;
    }
    if (hostRegistered) {
        setKuAdvancedStatus("Host is already registered", true);
        return;
    }
    const cloneFrom = document.getElementById("ku-host-clone-select")?.value || "";
    const fields = collectHostFieldsForm();
    setKuAdvancedStatus(
        cloneFrom
            ? `Registering host from clone of ${cloneFrom}...`
            : "Registering host with blank defaults..."
    );
    try {
        const res = await fetch("api/host/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clone_from: cloneFrom || null, fields }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to register host");
        }
        applyStationBootstrap({
            hostname: data.hostname,
            host_registered: data.host_registered,
            known_hosts: data.known_hosts,
            tools: data.tools,
            host_fields: data.host_fields,
            hw_config: data.hw_config,
        });
        fillHostFieldsForm(hostFields);
        if (hwConfig) {
            initializeUI();
        }
        updateStationGates();
        updateOperationAvailability();
        updateKuAdvancedControls();
        setKuAdvancedStatus(data.message || "Host registered");
        await loadKuAdvancedOptions();
    } catch (err) {
        console.error("Failed to register host:", err);
        setKuAdvancedStatus(err.message || "failed to register host", true);
    }
}

async function saveHostFields() {
    if (!globalEditUnlocked || !hostRegistered) {
        return;
    }
    const fields = collectHostFieldsForm();
    setKuAdvancedStatus("Saving host options...");
    try {
        const res = await fetch("api/host/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to save host options");
        }
        applyStationBootstrap({
            hostname: data.hostname || stationHostname,
            host_registered: data.host_registered,
            known_hosts: knownHosts,
            tools: data.tools || stationTools,
            host_fields: data.host_fields,
            hw_config: data.hw_config,
        });
        fillHostFieldsForm(hostFields);
        if (hwConfig) {
            rebuildKuRuntimeMaps();
            updateKuProgrammerBoxes();
            renderKuCableSelects();
        }
        updateStationGates();
        updateOperationAvailability();
        updateKuAdvancedControls();
        setKuAdvancedStatus("Host options saved");
    } catch (err) {
        console.error("Failed to save host options:", err);
        setKuAdvancedStatus(err.message || "failed to save host options", true);
    }
}

async function refreshStationTools() {
    try {
        const res = await fetch("api/tools");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to refresh tools");
        }
        stationTools = data.tools || stationTools;
        hostRegistered = data.host_registered === true;
        knownHosts = Array.isArray(data.known_hosts) ? data.known_hosts : knownHosts;
        stationHostname = data.hostname || stationHostname;
        updateStationGates();
        updateOperationAvailability();
        updateKuAdvancedControls();
        setKuAdvancedStatus("Tool availability refreshed");
    } catch (err) {
        console.error("Failed to refresh tools:", err);
        setKuAdvancedStatus(err.message || "failed to refresh tools", true);
    }
}

function renderKuJtagFreqSelect(selectedHz) {
    const select = document.getElementById("ku-jtag-freq-select");
    if (!select) {
        return;
    }

    kuJtagFreqSuppress = true;
    select.innerHTML = "";
    const choices = kuJtagFreqChoices.length ? kuJtagFreqChoices : [selectedHz].filter(Boolean);
    choices.forEach(hz => {
        const option = document.createElement("option");
        option.value = String(hz);
        option.textContent = formatJtagFreqLabel(hz);
        select.appendChild(option);
    });
    if (selectedHz) {
        select.value = String(selectedHz);
    }
    kuJtagFreqSuppress = false;
}

function renderKuCableSelects() {
    const selectA = document.getElementById("ku-cable-a-select");
    const selectB = document.getElementById("ku-cable-b-select");
    if (!selectA || !selectB) {
        return;
    }

    const defaultA = getKuDefaultSerial("a");
    const defaultB = getKuDefaultSerial("b");
    const selectedA = getKuSideSerial("a");
    const selectedB = getKuSideSerial("b");
    const serials = collectKuSerialChoices();
    if (selectedA && !serials.includes(selectedA)) serials.push(selectedA);
    if (selectedB && !serials.includes(selectedB)) serials.push(selectedB);
    serials.sort((a, b) => a.localeCompare(b));

    const buildOptions = (select, selected, defaultSerial) => {
        select.innerHTML = "";
        serials.forEach(serial => {
            const option = document.createElement("option");
            option.value = serial;
            option.textContent = serial === defaultSerial ? `${serial} (default)` : serial;
            select.appendChild(option);
        });
        if (selected && serials.includes(selected)) {
            select.value = selected;
        } else if (defaultSerial) {
            select.value = defaultSerial;
        }
    };

    kuCableSelectSuppress = true;
    buildOptions(selectA, selectedA, defaultA);
    buildOptions(selectB, selectedB, defaultB);
    kuCableSelectSuppress = false;
    renderKuHostSerialPickers();
}

function applyKuCableSelection(side, serial) {
    const defaultSerial = getKuDefaultSerial(side);
    if (!serial || serial === defaultSerial) {
        kuSessionCableOverrides[side] = null;
    } else {
        kuSessionCableOverrides[side] = serial;
    }
    rebuildKuRuntimeMaps();
    updateKuProgrammerBoxes();
    renderKuCableSelects();
}

async function loadKuHwConfigFile() {
    const editor = document.getElementById("ku-hw-config-editor");
    const pathEl = document.getElementById("ku-hw-config-path");
    try {
        const res = await fetch("api/hw_config/file");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to load hw_config file");
        }
        kuHwConfigFilePath = data.path || "";
        kuHwConfigFileText = JSON.stringify(data.config || {}, null, 2);
        if (pathEl) pathEl.textContent = kuHwConfigFilePath || "hw_config.json";
        if (editor && !kuHwConfigFileEditing) {
            editor.value = kuHwConfigFileText;
        }
    } catch (err) {
        console.error("Failed to load hw_config file:", err);
        setKuAdvancedStatus(err.message || "failed to load hw_config file", true);
    }
}

function formatKuGitStatusLine(git) {
    if (!git) {
        return "---";
    }
    const branch = git.branch || "?";
    const short = git.head_short || "???????";
    const dirty = git.dirty ? ` · dirty(${git.dirty_count || 0})` : " · clean";
    let track = "";
    if (git.upstream) {
        track = ` · ↑${git.ahead || 0} ↓${git.behind || 0}`;
    }
    return `${branch} @ ${short}${dirty}${track}`;
}

function renderKuGitStatus(git) {
    const lineEl = document.getElementById("ku-git-status-line");
    const dirtyEl = document.getElementById("ku-git-dirty-hint");
    if (lineEl) {
        lineEl.textContent = formatKuGitStatusLine(git);
        lineEl.title = git?.subject || "";
    }
    if (dirtyEl) {
        if (git?.dirty && Array.isArray(git.dirty_files) && git.dirty_files.length) {
            const preview = git.dirty_files.slice(0, 6).join("\n");
            const more = git.dirty_count > 6 ? `\n… +${git.dirty_count - 6} more` : "";
            dirtyEl.textContent = `Local changes present — Update may require force:\n${preview}${more}`;
            dirtyEl.hidden = false;
        } else {
            dirtyEl.textContent = "";
            dirtyEl.hidden = true;
        }
    }
}

function renderKuGitCommitSelect(commits, selectedHash) {
    const select = document.getElementById("ku-git-commit-select");
    if (!select) {
        return;
    }
    const previous = selectedHash || select.value || "";
    select.innerHTML = "";
    (commits || []).forEach(commit => {
        const option = document.createElement("option");
        option.value = commit.hash;
        const mark = commit.is_head ? "★ " : "  ";
        const date = (commit.date || "").slice(0, 10);
        option.textContent = `${mark}${commit.short}  ${date}  ${commit.subject || ""}`;
        if (commit.is_head) {
            option.classList.add("is-git-head");
        }
        select.appendChild(option);
    });
    if (previous && Array.from(select.options).some(opt => opt.value === previous)) {
        select.value = previous;
    } else {
        const head = (commits || []).find(c => c.is_head);
        if (head) {
            select.value = head.hash;
        }
    }
}

async function loadKuGitManager({ fetchRemote = true } = {}) {
    const refreshBtn = document.getElementById("ku-git-refresh-btn");
    if (refreshBtn) {
        refreshBtn.textContent = fetchRemote ? "Fetching..." : "Loading...";
    }
    kuGitBusy = true;
    updateKuAdvancedControls();
    try {
        const qs = fetchRemote ? "limit=40&fetch=1" : "limit=40&fetch=0";
        const res = await fetch(`api/git/commits?${qs}`);
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to load git commits");
        }
        kuGitCommits = data.commits || [];
        renderKuGitCommitSelect(kuGitCommits);
        renderKuGitStatus(data.git);
        if (data.fetch_error) {
            setKuGitStatus(`Git fetch warning: ${data.fetch_error}`, true);
        } else {
            setKuGitStatus(
                `Git: ${kuGitCommits.length} commit(s) from ${data.ref || "remote"}`
            );
        }
    } catch (err) {
        console.error("Failed to load git manager:", err);
        setKuGitStatus(err.message || "failed to load git commits", true);
    } finally {
        kuGitBusy = false;
        if (refreshBtn) {
            refreshBtn.textContent = "Refresh";
        }
        updateKuAdvancedControls();
    }
}

async function forceKuGitCheckout(commitHash, reason) {
    const confirmed = await askTypeConfirm({
        title: "Force git checkout",
        message:
            "ARE YOU SURE?\n\n" +
            `${reason || "Checkout blocked by local changes or conflicts."}\n\n` +
            `This will discard local modifications and reset hard to:\n${commitHash}\n\n` +
            "Untracked files may also be removed.",
        phrase: "force git",
        irreversible: true,
    });
    if (!confirmed) {
        setKuGitStatus("Force git cancelled");
        return false;
    }

    setKuGitStatus(`Force checking out ${commitHash.slice(0, 7)}...`);
    const res = await fetch("api/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            commit: commitHash,
            force: true,
            confirm_phrase: "force git",
        }),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || "force git checkout failed");
    }
    renderKuGitStatus(data.git);
    await loadKuGitManager({ fetchRemote: false });
    setKuGitStatus(
        `${data.message || "Force checkout done"}. Restart tile-wjtag to load new code.`
    );
    return true;
}

async function updateKuGitToSelected() {
    if (!globalEditUnlocked || kuGitBusy) {
        return;
    }
    const select = document.getElementById("ku-git-commit-select");
    const commitHash = select?.value;
    if (!commitHash) {
        setKuGitStatus("Select a commit first", true);
        return;
    }

    const commit = kuGitCommits.find(c => c.hash === commitHash);
    const label = commit
        ? `${commit.short} — ${commit.subject}`
        : commitHash.slice(0, 7);

    kuGitBusy = true;
    updateKuAdvancedControls();
    setKuGitStatus(`Updating to ${label}...`);
    try {
        const res = await fetch("api/git/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commit: commitHash, force: false }),
        });
        const data = await res.json();

        if (res.status === 409 || data.needs_force) {
            kuGitBusy = false;
            updateKuAdvancedControls();
            renderKuGitStatus(data.git);
            await forceKuGitCheckout(
                commitHash,
                data.error || "Local changes or conflicts prevent a clean checkout."
            );
            return;
        }

        if (!res.ok) {
            throw new Error(data.error || "git checkout failed");
        }

        renderKuGitStatus(data.git);
        await loadKuGitManager({ fetchRemote: false });
        setKuGitStatus(
            data.restart_recommended
                ? `${data.message || "Checkout done"}. Restart tile-wjtag to load new code.`
                : (data.message || "Already at selected commit")
        );
    } catch (err) {
        console.error("Git update failed:", err);
        setKuGitStatus(err.message || "git update failed", true);
    } finally {
        kuGitBusy = false;
        updateKuAdvancedControls();
    }
}

function renderKuProcessCounts(counts) {
    const lineEl = document.getElementById("ku-proc-status-line");
    const map = counts || {};
    const names = ["vivado_lab", "cs_server", "FPExpress_bin"];
    if (lineEl) {
        lineEl.textContent = names
            .map(name => `${name}: ${map[name] || 0}`)
            .join("  ·  ");
    }
    names.forEach(name => {
        const btn = document.getElementById(`ku-kill-${name}-btn`);
        if (!btn) {
            return;
        }
        const count = map[name] || 0;
        btn.textContent = count ? `${name} (${count})` : name;
    });
}

async function loadKuProcessStatus() {
    try {
        const res = await fetch("api/process_status");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to load process status");
        }
        renderKuProcessCounts(data.counts || {});
    } catch (err) {
        console.error("Failed to load process status:", err);
        setKuAdvancedStatus(err.message || "failed to load process status", true);
    }
}

async function killKuNamedProcess(name) {
    if (!globalEditUnlocked || !name) {
        return;
    }
    const confirmed = await askTypeConfirm({
        title: `Kill ${name}`,
        message:
            `Send SIGTERM to all running ${name} processes?\n\n` +
            "Use this to clear a stuck programmer/session without killing the others.",
        phrase: "kill",
        irreversible: false,
    });
    if (!confirmed) {
        return;
    }

    setKuAdvancedStatus(`Killing ${name}...`);
    try {
        const res = await fetch("api/kill_process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `failed to kill ${name}`);
        }
        renderKuProcessCounts(data.counts || {});
        const n = (data.killed_detail || []).length;
        setKuAdvancedStatus(
            n ? `Killed ${n} ${name} process(es)` : `No ${name} process running`
        );
    } catch (err) {
        console.error(`Failed to kill ${name}:`, err);
        setKuAdvancedStatus(err.message || `failed to kill ${name}`, true);
    }
}

async function restartLocalService(serviceName, statusSetter = setKuAdvancedStatus) {
    if (!globalEditUnlocked || !serviceName) {
        return;
    }
    const confirmed = await askTypeConfirm({
        title: `Restart ${serviceName}`,
        message:
            `Restart ${serviceName}.service now?\n\n` +
            (serviceName === "tile-wjtag"
                ? "The page may disconnect briefly while the service comes back."
                : "Active JTAG/hw_server sessions may drop."),
        phrase: "restart",
        irreversible: false,
    });
    if (!confirmed) {
        return;
    }

    statusSetter(`Restarting ${serviceName}...`);
    try {
        const res = await fetch("api/restart_service", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ service: serviceName }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `failed to restart ${serviceName}`);
        }
        statusSetter(`${serviceName}: ${data.result || "restart requested"}`);
    } catch (err) {
        console.error(`Failed to restart ${serviceName}:`, err);
        statusSetter(err.message || `failed to restart ${serviceName}`, true);
    }
}

async function loadKuAdvancedOptions() {
    try {
        const res = await fetch("api/ku/advanced");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to load advanced options");
        }
        if (Object.prototype.hasOwnProperty.call(data, "host_registered")) {
            hostRegistered = data.host_registered === true;
        }
        if (data.hostname) {
            stationHostname = data.hostname;
        }
        if (Array.isArray(data.known_hosts)) {
            knownHosts = data.known_hosts;
        }
        if (data.tools) {
            stationTools = data.tools;
        }
        if (data.host_fields) {
            hostFields = data.host_fields;
            fillHostFieldsForm(hostFields);
        }
        if (data.hw_config) {
            hwConfig = data.hw_config;
        }
        kuJtagFreqChoices = data.jtag_freq_choices || [];
        renderKuJtagFreqSelect(data.jtag_freq_hz);
        renderKuCableSelects();
        if (data.hw_config_path) {
            kuHwConfigFilePath = data.hw_config_path;
            const pathEl = document.getElementById("ku-hw-config-path");
            if (pathEl) pathEl.textContent = kuHwConfigFilePath;
        }
        await loadKuHwConfigFile();
        await loadKuProcessStatus();
        updateStationGates();
        updateOperationAvailability();
        updateKuAdvancedControls();
    } catch (err) {
        console.error("Failed to load KU advanced options:", err);
        setKuAdvancedStatus(err.message || "failed to load advanced options", true);
    }
}

async function saveKuJtagFrequency(freqHz) {
    if (!globalEditUnlocked) {
        return;
    }
    setKuAdvancedStatus(`Saving JTAG speed ${formatJtagFreqLabel(freqHz)}...`);
    try {
        const res = await fetch("api/ku/jtag_freq", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jtag_freq_hz: freqHz }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to save JTAG frequency");
        }
        if (data.hw_config) {
            hwConfig = data.hw_config;
            rebuildKuRuntimeMaps();
            updateKuProgrammerBoxes();
        }
        setKuAdvancedStatus(`JTAG speed saved: ${formatJtagFreqLabel(freqHz)}`);
    } catch (err) {
        console.error("Failed to save JTAG frequency:", err);
        setKuAdvancedStatus(err.message || "failed to save JTAG frequency", true);
        await loadKuAdvancedOptions();
    }
}

function collectKuSerialChoices() {
    const serials = new Set();
    const defaultA = getKuDefaultSerial("a");
    const defaultB = getKuDefaultSerial("b");
    if (defaultA) serials.add(defaultA);
    if (defaultB) serials.add(defaultB);
    (kuDiscoveredCables || []).forEach(cable => {
        const serial = (typeof cable === "string" ? cable : (cable?.serial || "")).trim();
        if (serial) serials.add(serial);
    });
    ["ku-host-serial-a", "ku-host-serial-b"].forEach(id => {
        const value = document.getElementById(id)?.value?.trim();
        if (value) serials.add(value);
    });
    return Array.from(serials).sort((a, b) => a.localeCompare(b));
}

function renderKuHostSerialPickers() {
    const serials = collectKuSerialChoices();
    ["a", "b"].forEach(side => {
        const pick = document.getElementById(`ku-host-serial-${side}`);
        if (!pick) {
            return;
        }
        const current = (pick.value || "").trim();
        pick.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "(Not Registered)";
        pick.appendChild(blank);

        serials.forEach(serial => {
            const opt = document.createElement("option");
            opt.value = serial;
            const discovered = (kuDiscoveredCables || []).some(c =>
                ((typeof c === "string" ? c : c?.serial) || "").trim() === serial
            );
            opt.textContent = discovered ? serial : `${serial} (saved)`;
            pick.appendChild(opt);
        });

        if (current && !serials.includes(current)) {
            const opt = document.createElement("option");
            opt.value = current;
            opt.textContent = `${current} (saved)`;
            pick.appendChild(opt);
        }
        pick.value = current;
        if (pick.value !== current) {
            pick.value = "";
        }
    });
}

function applyDiscoveredCablesToHostSerialFields(cables) {
    // Rebuild dropdowns with the full Vivado list; only set blank sides.
    const serials = (cables || [])
        .map(c => (typeof c === "string" ? c : (c?.serial || "")).trim())
        .filter(Boolean);

    const fieldA = document.getElementById("ku-host-serial-a");
    const fieldB = document.getElementById("ku-host-serial-b");
    const prevA = fieldA?.value?.trim() || "";
    const prevB = fieldB?.value?.trim() || "";
    const filled = [];

    renderKuHostSerialPickers();

    if (!serials.length) {
        return filled;
    }

    if (fieldA && !prevA && serials[0]) {
        fieldA.value = serials[0];
        filled.push(`A=${serials[0]}`);
    } else if (fieldA) {
        fieldA.value = prevA;
    }
    if (fieldB && !prevB) {
        const forB = serials.find(s => s !== (fieldA?.value || "").trim()) || serials[1];
        if (forB) {
            fieldB.value = forB;
            filled.push(`B=${forB}`);
        }
    } else if (fieldB) {
        fieldB.value = prevB;
    }
    renderKuHostSerialPickers();
    return filled;
}

async function refreshKuCablesFromVivado() {
    if (!globalEditUnlocked) {
        return;
    }
    if (!isVivadoAvailable()) {
        setKuAdvancedStatus("Vivado Lab is not available on this host", true);
        return;
    }
    const refreshBtn = document.getElementById("ku-cables-refresh-btn");
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Scanning...";
    }
    setKuAdvancedStatus("Opening Vivado session to list cables...");
    try {
        const res = await fetch("api/ku/cables");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to list cables");
        }
        kuDiscoveredCables = data.cables || [];
        renderKuCableSelects();
        const filled = applyDiscoveredCablesToHostSerialFields(kuDiscoveredCables);
        if (!kuDiscoveredCables.length) {
            setKuAdvancedStatus("No Digilent cables reported by Vivado");
        } else if (filled.length) {
            setKuAdvancedStatus(
                `Found ${kuDiscoveredCables.length} cable(s); filled blank host serial(s): ${filled.join(", ")}`
            );
        } else {
            setKuAdvancedStatus(
                `Found ${kuDiscoveredCables.length} cable(s) via Vivado ` +
                "(host serial fields already set — edit them or clear to auto-fill)"
            );
        }
    } catch (err) {
        console.error("Failed to list KU cables:", err);
        setKuAdvancedStatus(err.message || "failed to list cables", true);
    } finally {
        if (refreshBtn) {
            refreshBtn.textContent = "Refresh cables";
        }
        updateKuAdvancedControls();
    }
}

async function saveKuHwConfigFile() {
    if (!globalEditUnlocked || !kuHwConfigFileEditing) {
        return;
    }
    const editor = document.getElementById("ku-hw-config-editor");
    const raw = editor?.value || "";
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        setKuAdvancedStatus(`Invalid JSON: ${err.message}`, true);
        return;
    }

    setKuAdvancedStatus("Saving hw_config.json...");
    try {
        const res = await fetch("api/hw_config/file", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: parsed }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to save hw_config file");
        }

        kuHwConfigFileText = JSON.stringify(data.config || parsed, null, 2);
        if (data.hw_config) {
            hwConfig = data.hw_config;
        }
        if (Object.prototype.hasOwnProperty.call(data, "host_registered")) {
            hostRegistered = data.host_registered === true;
        }
        if (data.tools) {
            stationTools = data.tools;
        }
        if (data.hostname) {
            stationHostname = data.hostname;
        }
        knownHosts = Object.keys(data.config || parsed || {});
        kuHwConfigFileEditing = false;
        if (editor) {
            editor.value = kuHwConfigFileText;
        }
        rebuildKuRuntimeMaps();
        updateKuProgrammerBoxes();
        renderKuCableSelects();
        renderKuJtagFreqSelect(hwConfig?.ku?.jtag_freq_hz);
        updateStationGates();
        updateOperationAvailability();
        updateKuAdvancedControls();
        setKuAdvancedStatus("hw_config.json saved");
    } catch (err) {
        console.error("Failed to save hw_config file:", err);
        setKuAdvancedStatus(err.message || "failed to save hw_config file", true);
    }
}

function initKuGitManager() {
    if (kuGitWired) {
        updateKuAdvancedControls();
        return;
    }

    const modal = document.getElementById("ku-git-modal");
    const gitBtn = document.getElementById("ku-git-settings-btn");
    const closeBtn = document.getElementById("ku-git-close-btn");
    const doneBtn = document.getElementById("ku-git-done-btn");
    const gitRefreshBtn = document.getElementById("ku-git-refresh-btn");
    const gitUpdateBtn = document.getElementById("ku-git-update-btn");
    const gitRestartBtn = document.getElementById("ku-git-restart-btn");
    const gitSelect = document.getElementById("ku-git-commit-select");

    if (gitBtn) {
        gitBtn.addEventListener("click", () => {
            openKuGitModal();
        });
    }
    if (closeBtn) {
        closeBtn.addEventListener("click", closeKuGitModal);
    }
    if (doneBtn) {
        doneBtn.addEventListener("click", closeKuGitModal);
    }
    if (modal) {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeKuGitModal();
            }
        });
    }
    if (gitRefreshBtn) {
        gitRefreshBtn.addEventListener("click", () => {
            loadKuGitManager({ fetchRemote: true });
        });
    }
    if (gitUpdateBtn) {
        gitUpdateBtn.addEventListener("click", updateKuGitToSelected);
    }
    if (gitRestartBtn) {
        gitRestartBtn.addEventListener("click", () => {
            restartLocalService("tile-wjtag", setKuGitStatus);
        });
    }
    if (gitSelect) {
        gitSelect.addEventListener("change", () => {
            updateKuAdvancedControls();
            const commit = kuGitCommits.find(c => c.hash === gitSelect.value);
            if (commit) {
                setKuGitStatus(`Selected ${commit.short}: ${commit.subject || ""}`);
            }
        });
    }

    kuGitWired = true;
    updateKuAdvancedControls();
}

function initKuAdvancedOptions() {
    if (kuAdvancedWired) {
        updateKuAdvancedControls();
        return;
    }

    const modal = document.getElementById("ku-advanced-modal");
    const settingsBtn = document.getElementById("ku-advanced-settings-btn");
    const closeBtn = document.getElementById("ku-advanced-close-btn");
    const doneBtn = document.getElementById("ku-advanced-done-btn");
    const freqSelect = document.getElementById("ku-jtag-freq-select");
    const cableA = document.getElementById("ku-cable-a-select");
    const cableB = document.getElementById("ku-cable-b-select");
    const enableA = document.getElementById("ku-cable-a-enable");
    const enableB = document.getElementById("ku-cable-b-enable");
    const refreshBtn = document.getElementById("ku-cables-refresh-btn");
    const defaultsBtn = document.getElementById("ku-session-defaults-btn");
    const editBtn = document.getElementById("ku-hw-config-edit-btn");
    const saveBtn = document.getElementById("ku-hw-config-save-btn");
    const cancelBtn = document.getElementById("ku-hw-config-cancel-btn");
    const restartHwserverBtn = document.getElementById("ku-restart-hwserver-btn");
    const restartTileBtn = document.getElementById("ku-restart-tile-wjtag-btn");
    const procRefreshBtn = document.getElementById("ku-proc-refresh-btn");

    if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
            openKuAdvancedModal();
        });
    }

    if (enableA) {
        enableA.addEventListener("change", () => {
            if (kuCableEnableSuppress || !globalEditUnlocked) {
                return;
            }
            applyKuCableEnabled("a", enableA.checked);
        });
    }
    if (enableB) {
        enableB.addEventListener("change", () => {
            if (kuCableEnableSuppress || !globalEditUnlocked) {
                return;
            }
            applyKuCableEnabled("b", enableB.checked);
        });
    }
    if (defaultsBtn) {
        defaultsBtn.addEventListener("click", () => {
            forceDefaultKuSessionOptions();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", closeKuAdvancedModal);
    }
    if (doneBtn) {
        doneBtn.addEventListener("click", closeKuAdvancedModal);
    }
    if (modal) {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeKuAdvancedModal();
            }
        });
    }

    if (freqSelect) {
        freqSelect.addEventListener("change", async () => {
            if (kuJtagFreqSuppress || !globalEditUnlocked) {
                return;
            }
            const freq = Number(freqSelect.value);
            if (!freq) {
                return;
            }
            await saveKuJtagFrequency(freq);
        });
    }

    if (cableA) {
        cableA.addEventListener("change", () => {
            if (kuCableSelectSuppress || !globalEditUnlocked) {
                return;
            }
            applyKuCableSelection("a", cableA.value);
            setKuAdvancedStatus(`Cable A set to ${getKuSideSerial("a")} (session only)`);
        });
    }

    if (cableB) {
        cableB.addEventListener("change", () => {
            if (kuCableSelectSuppress || !globalEditUnlocked) {
                return;
            }
            applyKuCableSelection("b", cableB.value);
            setKuAdvancedStatus(`Cable B set to ${getKuSideSerial("b")} (session only)`);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener("click", refreshKuCablesFromVivado);
    }

    if (editBtn) {
        editBtn.addEventListener("click", () => {
            if (!globalEditUnlocked) {
                return;
            }
            kuHwConfigFileEditing = true;
            const editor = document.getElementById("ku-hw-config-editor");
            if (editor) {
                editor.value = kuHwConfigFileText;
                editor.focus();
            }
            updateKuAdvancedControls();
            setKuAdvancedStatus("Editing hw_config.json — auto-locks with Global after 60s idle");
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
            exitKuHwConfigFileEdit(true);
            setKuAdvancedStatus("Config edit cancelled");
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", saveKuHwConfigFile);
    }

    if (restartHwserverBtn) {
        restartHwserverBtn.addEventListener("click", () => {
            restartLocalService("hwserver-aux", setKuAdvancedStatus);
        });
    }
    if (restartTileBtn) {
        restartTileBtn.addEventListener("click", () => {
            restartLocalService("tile-wjtag", setKuAdvancedStatus);
        });
    }
    if (procRefreshBtn) {
        procRefreshBtn.addEventListener("click", async () => {
            setKuAdvancedStatus("Refreshing process counts...");
            await loadKuProcessStatus();
            setKuAdvancedStatus("Process counts updated");
        });
    }

    const hostRegisterBtn = document.getElementById("ku-host-register-btn");
    const hostSaveBtn = document.getElementById("ku-host-save-fields-btn");
    const toolsRefreshBtn = document.getElementById("ku-tools-refresh-btn");
    if (hostRegisterBtn && !hostRegisterBtn.dataset.wired) {
        hostRegisterBtn.addEventListener("click", registerCurrentHost);
        hostRegisterBtn.dataset.wired = "true";
    }
    if (hostSaveBtn && !hostSaveBtn.dataset.wired) {
        hostSaveBtn.addEventListener("click", saveHostFields);
        hostSaveBtn.dataset.wired = "true";
    }
    if (toolsRefreshBtn && !toolsRefreshBtn.dataset.wired) {
        toolsRefreshBtn.addEventListener("click", refreshStationTools);
        toolsRefreshBtn.dataset.wired = "true";
    }
    renderKuHostSerialPickers();

    document.querySelectorAll(".ku-kill-proc-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            killKuNamedProcess(btn.dataset.proc);
        });
    });

    kuAdvancedWired = true;
    initKuGitManager();
    updateKuAdvancedControls();
}

function buildKuRunUrl(action) {
    const params = new URLSearchParams();
    const defaultA = getKuDefaultSerial("a");
    const defaultB = getKuDefaultSerial("b");
    const serialA = getKuSideSerial("a");
    const serialB = getKuSideSerial("b");
    const enableA = isKuSideEnabled("a");
    const enableB = isKuSideEnabled("b");

    if (enableA && serialA && serialA !== defaultA) {
        params.set("cable_a", serialA);
    }
    if (enableB && serialB && serialB !== defaultB) {
        params.set("cable_b", serialB);
    }
    if (!enableA) {
        params.set("enable_a", "0");
    }
    if (!enableB) {
        params.set("enable_b", "0");
    }

    const query = params.toString();
    return query ? `run/${action}?${query}` : `run/${action}`;
}


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

    if (kuHwConfigFileEditing) {
        exitKuHwConfigFileEdit(true);
    }

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
        globalBtn.disabled = false;
    }

    updateKuFirmwareControls();
    updateKuAdvancedControls();

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
            if (!globalEditUnlocked) {
                const confirmed = confirm(
                    "Warning: unlock global edit mode?\n\n" +
                    "This enables KU firmware management, Advanced options (JTAG/cables/config),\n" +
                    "and daughterboard group edit toggles.\n" +
                    "Database changes still require group edit + Save.\n" +
                    "Auto-locks after 60s idle."
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
        "verify_ku_flash": ["ku_verify_side_a_status", "ku_verify_side_b_status", "ku_verify_side_a_id", "ku_verify_side_b_id"],
        "erase_ku_flash": ["ku_erase_side_a_status", "ku_erase_side_b_status", "ku_erase_side_a_id", "ku_erase_side_b_id"],
        "blank_check_ku_flash": ["ku_blank_side_a_status", "ku_blank_side_b_status", "ku_blank_side_a_id", "ku_blank_side_b_id"]
    };

    // Get all KU status boxes
    const allKUBoxes = [
        "ku_side_a_dna", "ku_side_b_dna",
        "ku_program_side_a_status", "ku_program_side_b_status", "ku_program_side_a_id", "ku_program_side_b_id",
        "ku_flash_side_a_status", "ku_flash_side_b_status", "ku_flash_side_a_id", "ku_flash_side_b_id",
        "ku_verify_side_a_status", "ku_verify_side_b_status", "ku_verify_side_a_id", "ku_verify_side_b_id",
        "ku_erase_side_a_status", "ku_erase_side_b_status", "ku_erase_side_a_id", "ku_erase_side_b_id",
        "ku_blank_side_a_status", "ku_blank_side_b_status", "ku_blank_side_a_id", "ku_blank_side_b_id"
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
    const isKuType = type.startsWith("ku");
    const sides = isKuType ? getKuEnabledSides() : ["a", "b"];
    let failed = false;
    let seen = 0;

    sides.forEach(side => {
        let statusId;

        if (type === "ku_program") statusId = `ku_program_side_${side}_status`;
        else if (type === "ku_flash_program") statusId = `ku_flash_side_${side}_status`;
        else if (type === "ku_verify") statusId = `ku_verify_side_${side}_status`;
        else if (type === "ku_flash_erase") statusId = `ku_erase_side_${side}_status`;
        else if (type === "ku_flash_blank") statusId = `ku_blank_side_${side}_status`;
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

    const required = isKuType ? Math.max(sides.length, 1) : 2;
    if (seen < required) {
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

function applyKuFirmwarePayload(data) {
    if (!data) {
        return;
    }
    if (Array.isArray(data.sets)) {
        kuFirmwareSets = data.sets;
    }
    if (data.details && typeof data.details === "object") {
        kuFirmwareDetails = data.details;
    }
    if (Object.prototype.hasOwnProperty.call(data, "active")) {
        kuFirmwareActive = data.active || null;
    }
}

function updateKuFirmwareControls() {
    const unlocked = globalEditUnlocked === true;
    const panel = document.getElementById("ku-fw-panel");
    const select = document.getElementById("ku-fw-set-select");
    const uploadBtn = document.getElementById("ku-fw-upload-btn");
    const downloadBtn = document.getElementById("ku-fw-download-btn");
    const deleteBtn = document.getElementById("ku-fw-delete-btn");
    const selected = select?.value || "";

    if (panel) {
        panel.classList.toggle("is-locked", !unlocked);
    }
    if (select) {
        select.disabled = !unlocked || kuFirmwareSets.length === 0;
    }
    if (uploadBtn) {
        uploadBtn.disabled = !unlocked;
    }
    if (downloadBtn) {
        downloadBtn.disabled = !unlocked || !kuFirmwareActive;
    }
    if (deleteBtn) {
        deleteBtn.disabled = !unlocked || !selected;
    }
}

function firmwareSetLabel(setName) {
    const meta = kuFirmwareDetails[setName];
    if (meta && meta.complete === false) {
        return `${setName} (bin only)`;
    }
    return setName;
}

function renderKuFirmwareSelect(sets, active) {
    const select = document.getElementById("ku-fw-set-select");
    if (!select) {
        return;
    }

    kuFirmwareSelectSuppress = true;
    select.innerHTML = "";

    if (!sets.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No firmware sets found";
        select.appendChild(option);
    } else {
        sets.forEach(setName => {
            const option = document.createElement("option");
            option.value = setName;
            option.textContent = firmwareSetLabel(setName);
            select.appendChild(option);
        });
        if (active && sets.includes(active)) {
            select.value = active;
        }
    }

    kuFirmwareSelectSuppress = false;
    updateKuFirmwareControls();
}

async function loadKuFirmwareSets() {
    try {
        const res = await fetch("api/ku/firmware");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "failed to load firmware sets");
        }
        applyKuFirmwarePayload(data);
        renderKuFirmwareSelect(kuFirmwareSets, kuFirmwareActive);
        updateKuFirmwareControls();
    } catch (err) {
        console.error("Failed to load KU firmware sets:", err);
    }
}

function getUploadStemAndExts(fileList) {
    const files = Array.from(fileList || []);
    const byExt = {};
    const stems = new Set();

    files.forEach(file => {
        const match = file.name.match(/^(.+)\.(bit|bin|ltx)$/i);
        if (!match) {
            return;
        }
        const stem = match[1];
        const ext = match[2].toLowerCase();
        byExt[ext] = file;
        stems.add(stem);
    });

    return { byExt, stems, files };
}

function classifyUploadSelection(byExt, stems) {
    const provided = Object.keys(byExt);
    if (!provided.length || stems.size !== 1) {
        return { ok: false, mode: null };
    }
    if (byExt.bit && byExt.bin && byExt.ltx && provided.length === 3) {
        return { ok: true, mode: "full" };
    }
    if (byExt.bin && provided.length === 1) {
        return { ok: true, mode: "bin_only" };
    }
    return { ok: false, mode: null };
}

function updateKuFirmwareUploadPreview() {
    const preview = document.getElementById("ku-fw-upload-preview");
    const errorEl = document.getElementById("ku-fw-upload-error");
    const filesInput = document.getElementById("ku-fw-upload-files");
    const tagInput = document.getElementById("ku-fw-upload-tag");
    if (!preview) {
        return;
    }

    const tag = (tagInput?.value || "").trim();
    const { byExt, stems } = getUploadStemAndExts(filesInput?.files);
    const classified = classifyUploadSelection(byExt, stems);

    if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
    }

    if (!filesInput?.files?.length) {
        preview.textContent = "Result: ---";
        return;
    }
    if (!classified.ok) {
        preview.textContent = "Result: select .bit+.bin+.ltx, or only .bin";
        return;
    }

    const stem = Array.from(stems)[0];
    const suffix = classified.mode === "bin_only" ? ".bin" : ".{bit,bin,ltx}";
    if (!tag) {
        preview.textContent = `Result: ${stem}_<tag>${suffix}`;
        return;
    }
    preview.textContent = `Result: ${stem}_${tag}${suffix}`;
}

function openKuFirmwareUploadModal() {
    if (!globalEditUnlocked) {
        return;
    }
    const modal = document.getElementById("ku-fw-upload-modal");
    const filesInput = document.getElementById("ku-fw-upload-files");
    const tagInput = document.getElementById("ku-fw-upload-tag");
    const errorEl = document.getElementById("ku-fw-upload-error");
    if (filesInput) filesInput.value = "";
    if (tagInput) tagInput.value = "";
    if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
    }
    updateKuFirmwareUploadPreview();
    if (modal) modal.hidden = false;
}

function closeKuFirmwareUploadModal() {
    const modal = document.getElementById("ku-fw-upload-modal");
    if (modal) modal.hidden = true;
}

function closeTypeConfirmModal(result) {
    const modal = document.getElementById("type-confirm-modal");
    if (modal) modal.hidden = true;
    const resolver = typeConfirmResolver;
    typeConfirmResolver = null;
    if (resolver) {
        resolver(Boolean(result));
    }
}

function askTypeConfirm({ title, message, phrase, irreversible = false }) {
    return new Promise(resolve => {
        const modal = document.getElementById("type-confirm-modal");
        const titleEl = document.getElementById("type-confirm-title");
        const messageEl = document.getElementById("type-confirm-message");
        const bannerEl = document.getElementById("type-confirm-banner");
        const phraseEl = document.getElementById("type-confirm-phrase");
        const inputEl = document.getElementById("type-confirm-input");
        const errorEl = document.getElementById("type-confirm-error");
        const okBtn = document.getElementById("type-confirm-ok");

        if (!modal || !inputEl) {
            resolve(false);
            return;
        }

        if (typeConfirmResolver) {
            typeConfirmResolver(false);
        }
        typeConfirmResolver = resolve;

        if (titleEl) titleEl.textContent = title || "Confirm";
        if (messageEl) messageEl.textContent = message || "";
        if (phraseEl) phraseEl.textContent = phrase || "";
        if (bannerEl) bannerEl.hidden = !irreversible;
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.textContent = "";
        }
        inputEl.value = "";
        if (okBtn) okBtn.disabled = true;
        modal.hidden = false;
        setTimeout(() => inputEl.focus(), 0);
    });
}

function syncTypeConfirmOkEnabled() {
    const inputEl = document.getElementById("type-confirm-input");
    const phraseEl = document.getElementById("type-confirm-phrase");
    const okBtn = document.getElementById("type-confirm-ok");
    const errorEl = document.getElementById("type-confirm-error");
    if (!inputEl || !okBtn || !phraseEl) {
        return;
    }
    const expected = (phraseEl.textContent || "").trim();
    const ok = inputEl.value.trim() === expected;
    okBtn.disabled = !ok;
    if (errorEl && ok) {
        errorEl.hidden = true;
        errorEl.textContent = "";
    }
}

function initTypeConfirmModal() {
    const modal = document.getElementById("type-confirm-modal");
    const cancelBtn = document.getElementById("type-confirm-cancel");
    const okBtn = document.getElementById("type-confirm-ok");
    const inputEl = document.getElementById("type-confirm-input");

    if (cancelBtn && !cancelBtn.dataset.wired) {
        cancelBtn.addEventListener("click", () => closeTypeConfirmModal(false));
        cancelBtn.dataset.wired = "true";
    }
    if (okBtn && !okBtn.dataset.wired) {
        okBtn.addEventListener("click", () => {
            const phraseEl = document.getElementById("type-confirm-phrase");
            const errorEl = document.getElementById("type-confirm-error");
            const expected = (phraseEl?.textContent || "").trim();
            if ((inputEl?.value || "").trim() !== expected) {
                if (errorEl) {
                    errorEl.hidden = false;
                    errorEl.textContent = `Type exactly: ${expected}`;
                }
                return;
            }
            closeTypeConfirmModal(true);
        });
        okBtn.dataset.wired = "true";
    }
    if (inputEl && !inputEl.dataset.wired) {
        inputEl.addEventListener("input", syncTypeConfirmOkEnabled);
        inputEl.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                if (okBtn && !okBtn.disabled) {
                    okBtn.click();
                }
            } else if (event.key === "Escape") {
                closeTypeConfirmModal(false);
            }
        });
        inputEl.dataset.wired = "true";
    }
    if (modal && !modal.dataset.wired) {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeTypeConfirmModal(false);
            }
        });
        modal.dataset.wired = "true";
    }
}

async function submitKuFirmwareUpload() {
    if (!globalEditUnlocked) {
        return;
    }

    const filesInput = document.getElementById("ku-fw-upload-files");
    const tagInput = document.getElementById("ku-fw-upload-tag");
    const errorEl = document.getElementById("ku-fw-upload-error");
    const confirmBtn = document.getElementById("ku-fw-upload-confirm");
    const tag = (tagInput?.value || "").trim();
    const { byExt, stems } = getUploadStemAndExts(filesInput?.files);
    const classified = classifyUploadSelection(byExt, stems);

    const showError = (message) => {
        if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = message;
        } else {
            alert(message);
        }
    };

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(tag)) {
        showError("Enter a valid tag (letters, numbers, . _ -).");
        return;
    }
    if (!classified.ok) {
        showError("Select .bit + .bin + .ltx with the same base name, or only a .bin file.");
        return;
    }

    let allowBinOnly = false;
    if (classified.mode === "bin_only") {
        const confirmed = await askTypeConfirm({
            title: "Bin-only firmware upload",
            message:
                "ARE YOU SURE?\n\n" +
                "You are uploading only a .bin file. FPGA bitstream programming (.bit/.ltx) " +
                "will not be available for this set — only flash memory ops that use the bin.",
            phrase: "only bin file",
            irreversible: false,
        });
        if (!confirmed) {
            return;
        }
        allowBinOnly = true;
    }

    const form = new FormData();
    form.append("tag", tag);
    form.append("allow_bin_only", allowBinOnly ? "1" : "0");
    if (byExt.bit) form.append("files", byExt.bit);
    if (byExt.bin) form.append("files", byExt.bin);
    if (byExt.ltx) form.append("files", byExt.ltx);

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Uploading...";
    }

    try {
        const res = await fetch("api/ku/firmware/upload", {
            method: "POST",
            body: form,
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "upload failed");
        }

        applyKuFirmwarePayload(data);
        renderKuFirmwareSelect(kuFirmwareSets, kuFirmwareActive);
        updateKuFirmwareControls();
        closeKuFirmwareUploadModal();

        const activate = confirm(
            `Uploaded firmware set "${data.set}".\n\nMake it the active set now?`
        );
        if (activate) {
            await selectKuFirmwareSet(data.set);
        }
    } catch (err) {
        console.error("Firmware upload failed:", err);
        showError(err.message || "upload failed");
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Upload";
        }
    }
}

async function selectKuFirmwareSet(setName) {
    if (!globalEditUnlocked || !setName) {
        return;
    }

    try {
        const res = await fetch("api/ku/firmware/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ set: setName }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "select failed");
        }

        applyKuFirmwarePayload(data);
        if (data.hw_config) {
            hwConfig = data.hw_config;
        }
        renderKuFirmwareSelect(kuFirmwareSets, kuFirmwareActive);
        updateKuFirmwareControls();
    } catch (err) {
        console.error("Failed to select firmware set:", err);
        alert(`Failed to select firmware set: ${err.message}`);
        renderKuFirmwareSelect(kuFirmwareSets, kuFirmwareActive);
    }
}

async function deleteSelectedKuFirmwareSet() {
    if (!globalEditUnlocked) {
        return;
    }

    const select = document.getElementById("ku-fw-set-select");
    const setName = (select?.value || "").trim();
    if (!setName) {
        return;
    }

    const confirmed = await askTypeConfirm({
        title: "Delete firmware set",
        message:
            `ARE YOU SURE you want to permanently delete "${setName}"?\n\n` +
            "This removes the .bit/.bin/.ltx files for that set from the station.",
        phrase: "delete me",
        irreversible: true,
    });
    if (!confirmed) {
        return;
    }

    try {
        const res = await fetch("api/ku/firmware/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ set: setName, confirm: "delete me" }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "delete failed");
        }

        applyKuFirmwarePayload(data);
        renderKuFirmwareSelect(kuFirmwareSets, kuFirmwareActive);
        updateKuFirmwareControls();
    } catch (err) {
        console.error("Failed to delete firmware set:", err);
        alert(`Failed to delete firmware set: ${err.message}`);
    }
}

function downloadCurrentKuFirmware() {
    if (!globalEditUnlocked || !kuFirmwareActive) {
        return;
    }
    window.location.href = "api/ku/firmware/download";
}

function initKuFirmwareControls() {
    initTypeConfirmModal();

    const uploadBtn = document.getElementById("ku-fw-upload-btn");
    const downloadBtn = document.getElementById("ku-fw-download-btn");
    const deleteBtn = document.getElementById("ku-fw-delete-btn");
    const select = document.getElementById("ku-fw-set-select");
    const modal = document.getElementById("ku-fw-upload-modal");
    const cancelBtn = document.getElementById("ku-fw-upload-cancel");
    const confirmBtn = document.getElementById("ku-fw-upload-confirm");
    const filesInput = document.getElementById("ku-fw-upload-files");
    const tagInput = document.getElementById("ku-fw-upload-tag");

    if (uploadBtn && !uploadBtn.dataset.wired) {
        uploadBtn.addEventListener("click", openKuFirmwareUploadModal);
        uploadBtn.dataset.wired = "true";
    }
    if (downloadBtn && !downloadBtn.dataset.wired) {
        downloadBtn.addEventListener("click", downloadCurrentKuFirmware);
        downloadBtn.dataset.wired = "true";
    }
    if (deleteBtn && !deleteBtn.dataset.wired) {
        deleteBtn.addEventListener("click", deleteSelectedKuFirmwareSet);
        deleteBtn.dataset.wired = "true";
    }
    if (select && !select.dataset.wired) {
        select.addEventListener("change", async () => {
            if (kuFirmwareSelectSuppress || !globalEditUnlocked) {
                updateKuFirmwareControls();
                return;
            }
            const next = select.value;
            updateKuFirmwareControls();
            if (!next || next === kuFirmwareActive) {
                return;
            }
            const confirmed = confirm(
                `Switch active KU firmware to "${next}"?\n\n` +
                "Programming/verify will use this set."
            );
            if (!confirmed) {
                renderKuFirmwareSelect(kuFirmwareSets, kuFirmwareActive);
                return;
            }
            await selectKuFirmwareSet(next);
        });
        select.dataset.wired = "true";
    }
    if (cancelBtn && !cancelBtn.dataset.wired) {
        cancelBtn.addEventListener("click", closeKuFirmwareUploadModal);
        cancelBtn.dataset.wired = "true";
    }
    if (confirmBtn && !confirmBtn.dataset.wired) {
        confirmBtn.addEventListener("click", submitKuFirmwareUpload);
        confirmBtn.dataset.wired = "true";
    }
    if (filesInput && !filesInput.dataset.wired) {
        filesInput.addEventListener("change", updateKuFirmwareUploadPreview);
        filesInput.dataset.wired = "true";
    }
    if (tagInput && !tagInput.dataset.wired) {
        tagInput.addEventListener("input", updateKuFirmwareUploadPreview);
        tagInput.dataset.wired = "true";
    }
    if (modal && !modal.dataset.wired) {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeKuFirmwareUploadModal();
            }
        });
        modal.dataset.wired = "true";
    }

    updateKuFirmwareControls();
}

function setFpgaGroupButtonsDisabled(group, disabled, activeAction = null) {
    operationBusyGroups[group] = Boolean(disabled);

    if (!disabled) {
        updateOperationAvailability();
        return;
    }

    document.querySelectorAll(`.fpga-op-btn[data-group="${group}"]`).forEach(btn => {
        btn.disabled = true;
        btn.classList.toggle("op-busy", true);

        const isActiveButton = Boolean(
            activeAction
            && btn.getAttribute("onclick")
            && btn.getAttribute("onclick").includes(`'${activeAction}'`)
        );
        btn.classList.toggle("btn-running", isActiveButton);
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

function getActiveKuFirmwarePaths() {
    const side = hwConfig?.ku?.sides?.a || {};
    return {
        bitfile: (side.bitfile || "").trim(),
        binfile: (side.binfile || "").trim(),
        ltxfile: (side.ltxfile || "").trim(),
    };
}

function preflightKuFirmwareAction(action) {
    const paths = getActiveKuFirmwarePaths();
    if (action === "program_ku") {
        if (!paths.bitfile) {
            alert(
                "Active firmware set has no .bit file.\n\n" +
                "Bin-only sets can be used for flash program/verify/erase/blank.\n" +
                "Select a full firmware set (.bit/.bin/.ltx) to program the FPGA."
            );
            return false;
        }
    }
    if (action === "program_ku_flash" || action === "verify_ku_flash") {
        if (!paths.binfile) {
            alert("Active firmware set has no .bin file.");
            return false;
        }
    }
    return true;
}

async function startAction(action, type) {
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

    if (!hostRegistered) {
        alert(
            `Host "${stationHostname || "?"}" is not registered in hw_config.json.\n\n` +
            "Unlock Global → Advanced options → Register this host."
        );
        return;
    }
    if (group === "ku" && !hasAnyKuSideRegistered()) {
        alert(
            `No KU cable serial is registered.\n\n` +
            `Leave a side blank for ${NOT_REGISTERED_LABEL}, or set at least one serial in Advanced options.`
        );
        return;
    }
    if (group === "ku" && !isVivadoAvailable()) {
        alert("Vivado Lab is not available on this host. KU operations stay disabled.");
        return;
    }
    if (group === "proasic" && !hasAnyProasicSideRegistered()) {
        alert(
            `No ProASIC programmer is registered.\n\n` +
            `Leave a side blank for ${NOT_REGISTERED_LABEL}, or set at least one ID in Advanced options.`
        );
        return;
    }
    if (group === "proasic" && !isFpExpressAvailable()) {
        alert("FPExpress is not available on this host. ProASIC operations stay disabled.");
        return;
    }

    lockAllEditModes(true);

    // Update HW status before starting
    await updateDetectedHW();

    if (type.includes("proasic")) {
        resetStatusBoxesForProasicAction(action); // ✅ resets only relevant boxes
    }

    if (type.includes("ku")) {
        resetDbBoxes();
        resetStatusBoxesForKUAction(action);
    }

    if (group === "ku" && !preflightKuFirmwareAction(action)) {
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


    const runUrl = group === "ku" ? buildKuRunUrl(action) : `run/${action}`;
    activeEventSources[group] = new EventSource(runUrl);
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
            } else if (type === "ku_flash_erase") {
                parseKuFlashErase(data.line);
            } else if (type === "ku_flash_blank") {
                parseKuFlashBlank(data.line);
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
                        [getKuSideSerial("a")]: "a",
                        [getKuSideSerial("b")]: "b"
                    };
                    const side = map[sideKey] || sideKey;

                    const statusId = type === "ku_program" ? `ku_program_side_${side}_status` :
                                    type === "ku_flash_program" ? `ku_flash_side_${side}_status` :
                                    type === "ku_flash_erase" ? `ku_erase_side_${side}_status` :
                                    type === "ku_flash_blank" ? `ku_blank_side_${side}_status` :
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
    const dnaRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const match = line.match(dnaRegex);

    if (!match) return;

    const serial = match[1];
    const dna = match[2];

    if (serial === getKuSideSerial("a")) {
        document.getElementById("ku_side_a_dna").innerText = dna;
    }
    if (serial === getKuSideSerial("b")) {
        document.getElementById("ku_side_b_dna").innerText = dna;
    }

    refreshDaughterboardSectionFromDnas();
    updateDaughterboardReadoutDnas();
}


// ----------------------------
// KU: parse verify lines
// ----------------------------
function parseKuVerify(line) {
    const dnaRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === getKuSideSerial("a")) document.getElementById("ku_verify_side_a_id").innerText = dna;
        if (serial === getKuSideSerial("b")) document.getElementById("ku_verify_side_b_id").innerText = dna;
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

    if (serial === getKuSideSerial("a")) {
        document.getElementById("ku_verify_side_a_status").innerText = statusText;
        document.getElementById("ku_verify_side_a_status").className = className;
    }
    if (serial === getKuSideSerial("b")) {
        document.getElementById("ku_verify_side_b_status").innerText = statusText;
        document.getElementById("ku_verify_side_b_status").className = className;
    }
}

// ----------------------------
// KU: parse program lines
// ----------------------------
function parseKuProgram(line) {
    const dnaRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === getKuSideSerial("a")) document.getElementById("ku_program_side_a_id").innerText = dna;
        if (serial === getKuSideSerial("b")) document.getElementById("ku_program_side_b_id").innerText = dna;
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

    if (serial === getKuSideSerial("a")) {
        document.getElementById("ku_program_side_a_status").innerText = statusText;
        document.getElementById("ku_program_side_a_status").className = className;
    }
    if (serial === getKuSideSerial("b")) {
        document.getElementById("ku_program_side_b_status").innerText = statusText;
        document.getElementById("ku_program_side_b_status").className = className;
    }
}

// ----------------------------
// KU: parse flash program lines
// ----------------------------
function parseKuFlashProgram(line) {
    const dnaRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === getKuSideSerial("a")) document.getElementById("ku_flash_side_a_id").innerText = dna;
        if (serial === getKuSideSerial("b")) document.getElementById("ku_flash_side_b_id").innerText = dna;
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

    if (serial === getKuSideSerial("a")) {
        document.getElementById("ku_flash_side_a_status").innerText = statusText;
        document.getElementById("ku_flash_side_a_status").className = className;
    }
    if (serial === getKuSideSerial("b")) {
        document.getElementById("ku_flash_side_b_status").innerText = statusText;
        document.getElementById("ku_flash_side_b_status").className = className;
    }
}

// ----------------------------
// KU: parse flash erase lines
// ----------------------------
function parseKuFlashErase(line) {
    const dnaRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === getKuSideSerial("a")) document.getElementById("ku_erase_side_a_id").innerText = dna;
        if (serial === getKuSideSerial("b")) document.getElementById("ku_erase_side_b_id").innerText = dna;
    }

    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";
        updateKuEraseStatus(serial, passed);
    }
}

function updateKuEraseStatus(serial, passed) {
    const statusText = passed ? "Erased" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === getKuSideSerial("a")) {
        document.getElementById("ku_erase_side_a_status").innerText = statusText;
        document.getElementById("ku_erase_side_a_status").className = className;
    }
    if (serial === getKuSideSerial("b")) {
        document.getElementById("ku_erase_side_b_status").innerText = statusText;
        document.getElementById("ku_erase_side_b_status").className = className;
    }
}

// ----------------------------
// KU: parse flash blank-check lines
// ----------------------------
function parseKuFlashBlank(line) {
    const dnaRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\).*FUSE_DNA\\s*=\\s*([0-9A-F]+)`, "i");
    const resultRegex = new RegExp(`\\((${getKuSideSerial("a")}|${getKuSideSerial("b")})\\)\\s+Tile Operation\\s+(Success|Failure)!`, "i");
    let match;

    if ((match = line.match(dnaRegex))) {
        const serial = match[1];
        const dna = match[2];
        if (serial === getKuSideSerial("a")) document.getElementById("ku_blank_side_a_id").innerText = dna;
        if (serial === getKuSideSerial("b")) document.getElementById("ku_blank_side_b_id").innerText = dna;
    }

    if ((match = line.match(resultRegex))) {
        const serial = match[1];
        const passed = match[2].toLowerCase() === "success";
        updateKuBlankStatus(serial, passed);
    }
}

function updateKuBlankStatus(serial, passed) {
    const statusText = passed ? "Blank" : "FAILED!";
    const className = passed ? "passed" : "failed";

    if (serial === getKuSideSerial("a")) {
        document.getElementById("ku_blank_side_a_status").innerText = statusText;
        document.getElementById("ku_blank_side_a_status").className = className;
    }
    if (serial === getKuSideSerial("b")) {
        document.getElementById("ku_blank_side_b_status").innerText = statusText;
        document.getElementById("ku_blank_side_b_status").className = className;
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

    if (!isHaSideRegistered(side)) {
        btn.classList.remove("on");
        btn.classList.add("off");
        btn.innerText = "N/A";
        btn.disabled = true;
        btn.classList.add("is-gated");
        btn.title = `HA entity for side ${String(side).toUpperCase()} ${NOT_REGISTERED_LABEL}`;
        return;
    }

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
    if (!hostRegistered) {
        alert(
            `Host "${stationHostname || "?"}" is not registered.\n\n` +
            "Register it in Advanced options before using power control."
        );
        return;
    }
    if (!isHaSideRegistered(side)) {
        alert(`Power side ${side.toUpperCase()} ${NOT_REGISTERED_LABEL}`);
        return;
    }
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
