const capture = document.querySelector("#capture");
const status = document.querySelector("#status");
const connection = document.querySelector("#connection");
const fileTypesList = document.querySelector("#file-types-list");
const trayToggle = document.querySelector("#tray-toggle");
const trayBadge = document.querySelector("#tray-badge");
const versionBadge = document.querySelector("#version-badge");

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

// Espelho de DEFAULT_DISABLED_EXTENSIONS (background.js): tipos que vêm
// desativados de fábrica.
const DEFAULT_DISABLED_EXTENSIONS = [
  ".JPG",
  ".JPEG",
  ".PNG",
  ".WEBP",
  ".GIF",
  ".TXT",
];

const version = chrome.runtime.getManifest().version;
if (versionBadge) {
  versionBadge.textContent = `v${version}`;
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

function renderTrayBadge(disabledCount = 0) {
  if (!trayBadge) return;
  if (disabledCount > 0) {
    trayBadge.textContent = `${CAPTURED_TYPES.length} formatos • ${disabledCount} desativados`;
  } else {
    trayBadge.textContent = `${CAPTURED_TYPES.length} formatos ativos`;
  }
}

function setTrayExpanded(expanded) {
  if (trayToggle) {
    trayToggle.setAttribute("aria-expanded", String(expanded));
  }
}

function renderFileTypes(disabledExtensions = []) {
  const disabled = new Set(
    disabledExtensions.map(value => {
      const cleaned = String(value || "").trim().toUpperCase();
      return cleaned.startsWith(".") ? cleaned : `.${cleaned}`;
    }),
  );

  renderTrayBadge(disabled.size);

  fileTypesList.replaceChildren(
    ...CAPTURED_TYPES.map(extension => {
      const button = document.createElement("button");
      const enabled = !disabled.has(extension);
      button.type = "button";
      button.className = "type-chip";
      button.textContent = extension.replace(".", "");
      button.setAttribute("aria-pressed", String(enabled));
      button.title = enabled
        ? `Capturando ${extension} automaticamente`
        : `${extension} será baixado nativamente pelo navegador`;
      button.addEventListener("click", async (e) => {
        e.stopPropagation();
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
      connection.title = "Integração desativada pelo usuário";
      status.textContent = "Ative a captura automática para conectar";
      status.classList.remove("connected");
      return;
    }
    chrome.runtime.sendMessage({ type: "bridge-status" }, response => {
      const connected = !chrome.runtime.lastError && response?.connected;
      connection.classList.toggle("connected", Boolean(connected));
      connection.title = connected ? "SF Downloader conectado e ativo" : "SF Downloader desconectado";
      status.textContent = connected ? "SF Downloader conectado e ativo" : "Abra o SF Downloader para conectar";
      status.classList.toggle("connected", Boolean(connected));
    });
  });
}

storageGet({ captureEnabled: false, disabledExtensions: null, trayOpen: false }).then(
  ({ captureEnabled = false, disabledExtensions, trayOpen = false }) => {
    const disabled = Array.isArray(disabledExtensions)
      ? disabledExtensions
      : [...DEFAULT_DISABLED_EXTENSIONS];
    if (!Array.isArray(disabledExtensions)) {
      storageSet({ disabledExtensions: disabled });
    }
    renderCapture(captureEnabled);
    renderFileTypes(disabled);
    setTrayExpanded(Boolean(trayOpen));
  },
);

if (trayToggle) {
  trayToggle.addEventListener("click", () => {
    const current = trayToggle.getAttribute("aria-expanded") === "true";
    const next = !current;
    setTrayExpanded(next);
    storageSet({ trayOpen: next });
  });
}

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
