const capture = document.querySelector("#capture");
const status = document.querySelector("#status");
const connection = document.querySelector("#connection");

const version = chrome.runtime.getManifest().version;
const versionSpan = document.querySelector("header div span");
if (versionSpan) {
  versionSpan.textContent = `Integração do navegador v${version}`;
}

function renderCapture(enabled) {
  capture.setAttribute("aria-checked", String(enabled));
}

function checkConnection() {
  chrome.storage.local.get("captureEnabled", ({ captureEnabled = false }) => {
    if (!captureEnabled) {
      connection.classList.remove("connected");
      connection.title = "Integração desativada";
      status.textContent = "Ative a captura para conectar";
      status.classList.remove("connected");
      return;
    }
    chrome.runtime.sendMessage({ type: "bridge-status" }, response => {
      const connected = !chrome.runtime.lastError && response?.connected;
      connection.classList.toggle("connected", Boolean(connected));
      connection.title = connected ? "Aplicativo conectado" : "Aplicativo desconectado";
      status.textContent = connected ? "Aplicativo conectado" : "Abra o SF Downloader para conectar";
      status.classList.toggle("connected", Boolean(connected));
    });
  });
}

chrome.storage.local.get("captureEnabled", ({ captureEnabled = false }) => renderCapture(captureEnabled));
capture.addEventListener("click", () => {
  const next = capture.getAttribute("aria-checked") !== "true";
  renderCapture(next);
  chrome.storage.local.set({ captureEnabled: next }, () => {
    checkConnection();
    chrome.runtime.sendMessage({ type: "capture-toggled", enabled: next });
  });
});

checkConnection();
// Check connection periodically when popup is open
setInterval(checkConnection, 2000);
