const capture = document.querySelector("#capture");
const status = document.querySelector("#status");
const connection = document.querySelector("#connection");
const fileTypesList = document.querySelector("#file-types-list");

const CAPTURED_TYPES = [
  ".JPG",
  ".JPEG",
  ".PNG",
  ".WEBP",
  ".GIF",
  ".MP4",
  ".MKV",
  ".MOV",
  ".AVI",
  ".WEBM",
  ".MP3",
  ".WAV",
  ".FLAC",
  ".OGG",
  ".PDF",
  ".DOC",
  ".DOCX",
  ".XLS",
  ".XLSX",
  ".PPTX",
  ".TXT",
  ".ZIP",
  ".RAR",
  ".7Z",
  ".TAR",
  ".GZ",
  ".TGZ",
  ".EXE",
  ".MSI",
  ".APK",
  ".BAT",
  ".TORRENT",
  ".ISO",
  ".BIN",
];

const version = chrome.runtime.getManifest().version;
const versionSpan = document.querySelector("header div span");
if (versionSpan) {
  versionSpan.textContent = `Integração do navegador v${version}`;
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function renderCapture(enabled) {
  capture.setAttribute("aria-checked", String(enabled));
}

function renderFileTypes(disabledExtensions = []) {
  const disabled = new Set(
    disabledExtensions.map(value => {
      const cleaned = String(value || "").trim().toUpperCase();
      return cleaned.startsWith(".") ? cleaned : `.${cleaned}`;
    }),
  );
  fileTypesList.replaceChildren(
    ...CAPTURED_TYPES.map(extension => {
      const button = document.createElement("button");
      const enabled = !disabled.has(extension);
      button.type = "button";
      button.className = "type-chip";
      button.textContent = extension.replace(".", "");
      button.setAttribute("aria-pressed", String(enabled));
      button.title = enabled
        ? `Capturando ${extension}`
        : `${extension} fica no navegador`;
      button.addEventListener("click", async () => {
        const nextDisabled = new Set(disabled);
        if (nextDisabled.has(extension)) nextDisabled.delete(extension);
        else nextDisabled.add(extension);
        const value = [...nextDisabled].sort();
        await storageSet({ disabledExtensions: value });
        chrome.runtime.sendMessage({
          type: "extension-filters-updated",
          disabledExtensions: value,
        });
        renderFileTypes(value);
      });
      return button;
    }),
  );
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

storageGet({ captureEnabled: false, disabledExtensions: [] }).then(
  ({ captureEnabled = false, disabledExtensions = [] }) => {
    renderCapture(captureEnabled);
    renderFileTypes(disabledExtensions);
  },
);

capture.addEventListener("click", () => {
  const next = capture.getAttribute("aria-checked") !== "true";
  renderCapture(next);
  chrome.storage.local.set({ captureEnabled: next }, () => {
    checkConnection();
    chrome.runtime.sendMessage({ type: "capture-toggled", enabled: next });
  });
});

checkConnection();
setInterval(checkConnection, 2000);
