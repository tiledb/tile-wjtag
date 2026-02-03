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
