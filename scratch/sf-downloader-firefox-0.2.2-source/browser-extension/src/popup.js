const capture = document.querySelector("#capture");
const status = document.querySelector("#status");
const connection = document.querySelector("#connection");

function renderCapture(enabled) {
  capture.setAttribute("aria-checked", String(enabled));
}

function checkConnection() {
  chrome.runtime.sendMessage({ type: "bridge-status" }, response => {
    const connected = !chrome.runtime.lastError && response?.connected;
    connection.classList.toggle("connected", Boolean(connected));
    connection.title = connected ? "Aplicativo conectado" : "Aplicativo desconectado";
    status.textContent = connected ? "Aplicativo conectado" : "Abra o SF Downloader para conectar";
    status.classList.toggle("connected", Boolean(connected));
  });
}

chrome.storage.local.get("captureEnabled", ({ captureEnabled = false }) => renderCapture(captureEnabled));
capture.addEventListener("click", () => {
  const next = capture.getAttribute("aria-checked") !== "true";
  renderCapture(next);
  chrome.storage.local.set({ captureEnabled: next });
});

checkConnection();
