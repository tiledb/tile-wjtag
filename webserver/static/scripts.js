// ==========================
// Handle server selection
// ==========================
const hwServerSelect = document.getElementById("hw_server");
const hiddenFpga = document.getElementById("hidden_hw_server_fpga");
const hiddenFlash = document.getElementById("hidden_hw_server_flash");
const hiddenTests = document.getElementById("hidden_hw_server_tests"); // new hidden field

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

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop(); // incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          // fallback if not JSON
          parsed = { type: "log", line: line };
        }

        if (parsed.type === "log") {
          output.textContent += parsed.line;
          output.scrollTop = output.scrollHeight;
        }

        if (jsonCallback) {
          jsonCallback(parsed);
        }
      }
    }

    // Process any leftover
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
// Helper to render tree as HTML
// ==========================
function renderTree(tree) {
  let html = `<ul><li>${tree.server}`;
  if (tree.targets && tree.targets.length) {
    html += "<ul>";
    for (const t of tree.targets) {
      html += `<li>${t.name}<ul>`;
      for (const d of t.devices) {
        html += `<li>${d}</li>`;
      }
      html += "</ul></li>";
    }
    html += "</ul>";
  }
  html += "</li></ul>";
  return html;
}

// ==========================
// Attach forms
// ==========================
streamForm("fpga-form", "fpga-output", "/program_fpga");
streamForm("flash-form", "flash-output", "/program_flash");
streamForm("tests-form", "tests-output", "/list_hw", (item) => {
  if (item.type === "tree") {
    const treeDiv = document.getElementById("tests-tree");
    treeDiv.innerHTML = renderTree(item.tree);
  }
});
