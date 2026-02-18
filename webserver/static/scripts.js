// ==========================
// Handle server selection
// ==========================
const hwServerSelect = document.getElementById("hw_server");
const hiddenFpga = document.getElementById("hidden_hw_server_fpga");
const hiddenFlash = document.getElementById("hidden_hw_server_flash");
const hiddenTests = document.getElementById("hidden_hw_server_tests");

// Initialize hidden fields with first selection
hiddenFpga.value = hwServerSelect.value;
hiddenFlash.value = hwServerSelect.value;
hiddenTests.value = hwServerSelect.value;

// Update hidden fields when drop-down changes
hwServerSelect.addEventListener("change", () => {
  hiddenFpga.value = hwServerSelect.value;
  hiddenFlash.value = hwServerSelect.value;
  hiddenTests.value = hwServerSelect.value;

  loadTargetsForServer(hwServerSelect.value);
  loadFlashTargetsForServer(hwServerSelect.value);
});

// ==========================
// Stream form submission to output (with optional JSON callback)
// ==========================
function streamForm(formId, outputId, url, jsonCallback = null) {
  const form = document.getElementById(formId);
  const output = document.getElementById(outputId);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    output.textContent = "";

    const formData = new FormData(form);
    const response = await fetch(url, { method: "POST", body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          parsed = { type: "log", line: line }; // fallback
        }

        if (parsed.type === "log") {
          output.textContent += parsed.line;
          output.scrollTop = output.scrollHeight;
        }

        if (jsonCallback) jsonCallback(parsed);
      }
    }

    // Process leftover
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.type === "log") {
          output.textContent += parsed.line;
          output.scrollTop = output.scrollHeight;
        }
        if (jsonCallback) jsonCallback(parsed);
      } catch {}
    }
  });
}

// ==========================
// Collapsible tree with icons
// ==========================
function renderTree(tree) {
  function renderNode(node) {
    if (node.devices) {
      // Target node
      let html = `<li><span class="toggle">▶</span> 🎯 ${node.name}<ul class="nested">`;
      for (const d of node.devices) {
        html += `<li>⚙️ ${d}</li>`; // device icon
      }
      html += "</ul></li>";
      return html;
    } else if (node.server) {
      // Server root
      let html = `<ul><li><span class="toggle">▶</span> 🖥️ ${node.server}<ul class="nested">`;
      for (const t of node.targets) {
        html += renderNode(t);
      }
      html += "</ul></li></ul>";
      return html;
    }
    return "";
  }

  const container = document.getElementById("tests-tree");
  container.innerHTML = renderNode(tree);

  // Add toggle click events
  const toggles = container.querySelectorAll(".toggle");
  toggles.forEach((t) => {
    t.addEventListener("click", function () {
      const nested = this.parentElement.querySelector(".nested");
      if (nested) {
        nested.classList.toggle("active");
        this.textContent = nested.classList.contains("active") ? "▼" : "▶";
      }
    });
  });
}

// ==========================
// Attach forms
// ==========================
streamForm("fpga-form", "fpga-output", "/program_fpga");
streamForm("flash-form", "flash-output", "/program_flash");
streamForm("tests-form", "tests-output", "/list_hw", (item) => {
  if (item.type === "tree") {
    renderTree(item.tree);
  }
});


// ==========================
// Load FPGA Targets Dynamically
// ==========================

const targetsContainer = document.getElementById("fpga-targets-container");

async function loadTargetsForServer(serverAddress) {
  targetsContainer.innerHTML = "Loading targets...";

  const formData = new FormData();
  formData.append("hw_server", serverAddress);

  const response = await fetch("/get_targets", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  targetsContainer.innerHTML = "";

  if (!data.targets || data.targets.length === 0) {
    targetsContainer.innerHTML = "<i>No targets configured.</i>";
    return;
  }

  data.targets.forEach((t, index) => {
    const id = `target_${index}`;

    const div = document.createElement("div");
    div.className = "form-check";

    div.innerHTML = `
      <input class="form-check-input" type="checkbox"
             name="selected_targets"
             value="${t.target}|${t.device}"
             id="${id}" checked>
      <label class="form-check-label" for="${id}">
        ${t.target} — ${t.device}
      </label>
    `;

    targetsContainer.appendChild(div);
  });
}
// Load targets initially
loadTargetsForServer(hwServerSelect.value);


// ==========================
// Load Flash Targets Dynamically
// ==========================

const flashTargetsContainer = document.getElementById("flash-targets-container");

async function loadFlashTargetsForServer(serverAddress) {
  flashTargetsContainer.innerHTML = "Loading targets...";

  const formData = new FormData();
  formData.append("hw_server", serverAddress);

  const response = await fetch("/get_targets", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  flashTargetsContainer.innerHTML = "";

  if (!data.targets || data.targets.length === 0) {
    flashTargetsContainer.innerHTML = "<i>No targets configured.</i>";
    return;
  }

  data.targets.forEach((t, index) => {
    const id = `flash_target_${index}`;

    const div = document.createElement("div");
    div.className = "form-check";

    div.innerHTML = `
      <input class="form-check-input"
             type="checkbox"
             name="selected_flash_targets"
             value="${t.target}|${t.device}"
             id="${id}" checked>
      <label class="form-check-label" for="${id}">
        ${t.target} — ${t.device}
      </label>
    `;

    flashTargetsContainer.appendChild(div);
  });
}
// Load flash targets initially
loadFlashTargetsForServer(hwServerSelect.value);


function renderProasicTree(tree) {
    const container = document.getElementById("proasic-tests-tree");
    container.innerHTML = "";

    const serverNode = document.createElement("div");
    serverNode.innerHTML = "<b>Server:</b> " + tree.server;
    container.appendChild(serverNode);

    if (tree.programmers) {
        tree.programmers.forEach(prg => {
            const p = document.createElement("div");
            p.style.marginLeft = "20px";
            p.textContent = "Programmer: " + prg;
            container.appendChild(p);
        });
    }
}

// ==============================
// ProASIC Tests
// ==============================
document.getElementById("proasic-tests-form").addEventListener("submit", function (e) {
    e.preventDefault();   // 🔥 THIS prevents tab reset

    const output = document.getElementById("proasic-tests-output");
    const treeContainer = document.getElementById("proasic-tests-tree");

    output.textContent = "";
    treeContainer.innerHTML = "";

    const server = document.getElementById("proasic_server").value;
    document.getElementById("hidden_proasic_server_tests").value = server;

    const formData = new FormData(this);

    fetch("/list_proasic", {
        method: "POST",
        body: formData
    }).then(response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        function read() {
            reader.read().then(({ done, value }) => {
                if (done) return;

                const chunk = decoder.decode(value);
                const lines = chunk.trim().split("\n");

                lines.forEach(line => {
                    if (!line) return;
                    const data = JSON.parse(line);

                    if (data.type === "log") {
                        output.textContent += data.line;
                        output.scrollTop = output.scrollHeight;
                    }

                    if (data.type === "tree") {
                        renderProasicTree(data.tree);
                    }
                });

                read();
            });
        }

        read();
    });
});


function runProasic(action) {

  const form = document.getElementById("proasic-form");
  const formData = new FormData(form);

  formData.append("proasic_server",
    document.getElementById("proasic_server").value);

  formData.append("action", action);

  fetch("/proasic_action", {
    method: "POST",
    body: formData
  }).then(response => {

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) return;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        lines.forEach(line => {
          if (!line.trim()) return;
          const data = JSON.parse(line);
          document.getElementById("proasic-tests-output")
            .textContent += data.line;
        });

        read();
      });
    }

    read();
  });
}
