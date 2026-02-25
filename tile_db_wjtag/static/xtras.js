function showLoading(text="Working...") {
  document.querySelector(".loading-text").innerText = text;
  document.getElementById("loading-overlay").style.display = "flex";
}

function hideLoading() {
  document.getElementById("loading-overlay").style.display = "none";
}
