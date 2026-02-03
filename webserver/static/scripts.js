// ==========================
// Handle server selection
// ==========================
const hwServerSelect = document.getElementById("hw_server");
const hiddenFpga = document.getElementById("hidden_hw_server_fpga");
const hiddenFlash = document.getElementById("hidden_hw_server_flash");

// Initialize hidden fields with first selection
hiddenFpga.value = hwServerSelect.value;
hiddenFlash.value = hwServerSelect.value;

// Update hidden fields when drop-down changes
hwServerSelect.addEventListener("change", () => {
  hiddenFpga.value = hwServerSelect.value;
  hiddenFlash.value = hwServerSelect.value;
});

// ==========================
// Stream form submission to output
// ==========================
function streamForm(formId, outputId, url) {
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

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output.textContent += decoder.decode(value);
      output.scrollTop = output.scrollHeight;
    }
  });
}

// Attach forms
streamForm("fpga-form", "fpga-output", "/program_fpga");
streamForm("flash-form", "flash-output", "/program_flash");
