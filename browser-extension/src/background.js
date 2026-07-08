const MENU_ID = "sf-downloader-download";
const BRIDGE = "http://127.0.0.1:17831";
let bridge = { connected: false, token: "", fileExts: [], blockedHosts: [] };
let captureEnabledState = true;
let disabledExtensionsState = [];
const requests = new Map();
const recentHeaders = new Map();
const intercepted = new Set();
const interceptedUrls = new Map();

const validUrl = url => /^https?:\/\//i.test(url || "");

// Tracks URLs already taken over so a single browser download is not sent to
// the app twice (once via onHeadersReceived, once via onDeterminingFilename).
function markInterceptedUrl(url) {
  if (!url) return;
  interceptedUrls.set(url, Date.now());
  setTimeout(() => {
    if (interceptedUrls.get(url) && Date.now() - interceptedUrls.get(url) >= 5000) {
      interceptedUrls.delete(url);
    }
  }, 5000);
}
function wasInterceptedUrl(url) {
  return Boolean(url) && interceptedUrls.has(url);
}
const normalizeExtension = value => {
  const cleaned = String(value || "").trim().toUpperCase();
  if (!cleaned) return "";
  return cleaned.startsWith(".") ? cleaned : `.${cleaned}`;
};

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function applyExtensionFilters(fileExts, disabledExtensions = []) {
  const blocked = new Set((disabledExtensions || []).map(normalizeExtension).filter(Boolean));
  return (fileExts || []).map(normalizeExtension).filter(ext => ext && !blocked.has(ext));
}

function saveBridgeToStorage() {
  chrome.storage.local.set({
    connected: bridge.connected,
    fileExts: bridge.fileExts || [],
    blockedHosts: bridge.blockedHosts || []
  });
}

let syncPromise = null;

function syncBridge() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const { captureEnabled = captureEnabledState, disabledExtensions = disabledExtensionsState } = await storageGet(["captureEnabled", "disabledExtensions"]);
    captureEnabledState = captureEnabled;
    disabledExtensionsState = disabledExtensions || [];
    if (!captureEnabledState) {
      if (bridge.connected) {
        try { await fetch(`${BRIDGE}/disconnect`, { method: "POST" }); } catch {}
      }
      bridge.connected = false;
      saveBridgeToStorage();
      return;
    }

    try {
      const response = await fetch(`${BRIDGE}/sync`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      bridge = {
        connected: true,
        ...data,
        allFileExts: (data.fileExts || []).map(normalizeExtension).filter(Boolean),
        fileExts: applyExtensionFilters(data.fileExts, disabledExtensionsState)
      };
      saveBridgeToStorage();
    } catch {
      bridge.connected = false;
      saveBridgeToStorage();
    }
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

function launchProtocol(url) {
  return chrome.tabs.create({ url: `sfdownloader://download?url=${encodeURIComponent(url)}`, active: false })
    .then(tab => { if (tab.id) setTimeout(() => chrome.tabs.remove(tab.id).catch(() => undefined), 1200); });
}

function shouldTakeOver(url, filename) {
  if (!bridge.connected || !validUrl(url)) return false;
  const parsed = new URL(url);
  if ((bridge.blockedHosts || []).some(host => parsed.host.includes(host))) return false;
  const target = (filename || parsed.pathname).toUpperCase();
  return (bridge.fileExts || []).some(ext => target.endsWith(ext));
}

function shouldInterceptHeaders(info) {
  if (!bridge.connected) return null;

  // Block POST requests (same as XDM's shouldInterceptFile)
  if (info.method && info.method !== "GET") return null;

  // Only intercept successful responses
  if (info.statusCode && info.statusCode !== 200 && info.statusCode !== 206) return null;

  const url = info.url;
  if (!validUrl(url)) return null;

  const parsed = new URL(url);
  if (parsed.host === "127.0.0.1:17831" || parsed.host === "localhost:17831") return null;
  if ((bridge.blockedHosts || []).some(host => parsed.host.includes(host))) return null;

  // Parse response headers
  let filename = null;
  let fileSize = null;
  let mimeType = null;
  let isAttachment = false;

  for (const header of info.responseHeaders || []) {
    const name = header.name.toLowerCase();
    const value = header.value || "";
    if (name === "content-disposition") {
      // Extract filename from Content-Disposition (same as XDM's getAttachedFile)
      const parts = value.split(";");
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.toLowerCase().startsWith("filename*=")) {
          const encoded = trimmed.substring(10).trim().replace(/^['"]|['"]$/g, "");
          const value = encoded.includes("''") ? encoded.split("''").slice(1).join("''") : encoded;
          try {
            filename = decodeURIComponent(value);
          } catch {
            filename = value;
          }
        } else if (trimmed.toLowerCase().startsWith("filename=")) {
          filename = trimmed.substring(9).replace(/['"]/g, "").trim();
        }
      }
      // A forced download (XDM takes these over regardless of resource type)
      isAttachment = /attachment/i.test(value);
    }
    if (name === "content-type") {
      mimeType = value.split(";")[0].trim().toLowerCase();
    }
    if (name === "content-length") {
      fileSize = parseInt(value, 10) || null;
    }
  }

  // === XDM approach: only intercept real downloads ===
  // A passive prefetch (e.g. YouTube thumbnail on hover, lazy <img>, media preview)
  // is fetched as an `image`/`media`/subresource type with NO Content-Disposition
  // attachment. Those must NOT be taken over, or the browser spawns fake downloads.
  // We only intercept when it is a user navigation (main_frame/sub_frame) OR a
  // forced download (Content-Disposition: attachment).
  const isNavigation = info.type === "main_frame" || info.type === "sub_frame";
  if (!isNavigation && !isAttachment) return null;

  // === XDM's isHtmlOrScript: block web content MIME types ===
  // (XDM blockedMimeList: text/javascript, application/javascript, text/css, text/html)
  // We extend this with more web types for extra safety
  const blockedMimeList = [
    "text/html", "application/xhtml+xml",
    "text/javascript", "application/javascript",
    "text/css",
    "application/json",  // Google APIs send JSON with attachment headers
    "text/xml", "application/xml",
    "text/plain"
  ];
  if (mimeType && blockedMimeList.some(blocked => mimeType.includes(blocked))) {
    return null;
  }

  // === XDM's core logic: get filename, then check extension against fileExts ===
  // If no filename from Content-Disposition, extract from URL path (XDM's getFileFromUrl)
  if (!filename) {
    filename = parsed.pathname.split("/").pop() || null;
  }

  // Get file extension (XDM's getFileExtension)
  const ext = filename ? filename.substring(filename.lastIndexOf(".") + 1).toUpperCase() : null;

  // CRITICAL: XDM ALWAYS requires the extension to be in fileExts.
  // If extension doesn't match (e.g. ".txt", ".json"), it is NOT intercepted.
  if (ext && ext !== filename?.toUpperCase()) { // has a real extension (not just the filename itself)
    if ((bridge.fileExts || []).some(allowed => allowed === "." + ext || allowed === ext)) {
      return { filename, fileSize, mimeType };
    }
  }

  // Extension not in whitelist — do NOT intercept
  return null;
}

function cookiesFor(url) {
  return new Promise(resolve => chrome.cookies.getAll({ url }, cookies => {
    void chrome.runtime.lastError;
    resolve((cookies || []).map(cookie => `${cookie.name}=${cookie.value}`).join("; "));
  }));
}

async function sendToApp(download) {
  const url = download.finalUrl || download.url;

  const observed = recentHeaders.get(url) || {};
  const cookie = await cookiesFor(url);
  const payload = {
    token: bridge.token,
    url,
    filename: download.filename || null,
    fileSize: download.fileSize > 0 ? download.fileSize : observed.fileSize || null,
    mimeType: download.mime || observed.mimeType || null,
    referrer: download.referrer || observed.referrer || null,
    cookie: cookie || null,
    requestHeaders: observed.requestHeaders || download.requestHeaders || { "User-Agent": [navigator.userAgent] }
  };
  try {
    const response = await fetch(`${BRIDGE}/download`, { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    await launchProtocol(url);
  }
}

function eraseDownload(id) {
  chrome.downloads.cancel(id, () => {
    void chrome.runtime.lastError;
    chrome.downloads.erase({ id }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => {
        chrome.downloads.erase({ id }, () => void chrome.runtime.lastError);
      }, 100);
      setTimeout(() => {
        chrome.downloads.erase({ id }, () => void chrome.runtime.lastError);
      }, 500);
    });
  });
}

function onDeterminingFilename(download, suggest) {
  const url = download.finalUrl || download.url;
  syncBridge().then(() => {
    if (!captureEnabledState || intercepted.has(download.id) || wasInterceptedUrl(url) || !shouldTakeOver(url, download.filename)) {
      suggest();
      return;
    }
    intercepted.add(download.id);
    markInterceptedUrl(url);
    eraseDownload(download.id);
    sendToApp(download)
      .catch(() => {})
      .finally(() => {
        setTimeout(() => intercepted.delete(download.id), 5000);
        suggest();
      });
  }).catch(() => {
    suggest();
  });
  return true;
}

try {
  chrome.webRequest.onSendHeaders.addListener(info => {
    if (info.method !== "GET") return;
    const headers = {};
    for (const header of info.requestHeaders || []) {
      if (!header.value) continue;
      (headers[header.name] ||= []).push(header.value);
    }
    requests.set(info.requestId, { url: info.url, requestHeaders: headers, referrer: info.initiator || null });
  }, { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]);
} catch {
  chrome.webRequest.onSendHeaders.addListener(info => {
    if (info.method !== "GET") return;
    const headers = {};
    for (const header of info.requestHeaders || []) {
      if (!header.value) continue;
      (headers[header.name] ||= []).push(header.value);
    }
    requests.set(info.requestId, { url: info.url, requestHeaders: headers, referrer: info.initiator || null });
  }, { urls: ["<all_urls>"] }, ["requestHeaders"]);
}

let registered = false;

try {
  chrome.webRequest.onHeadersReceived.addListener(info => {
    const interceptDetails = shouldInterceptHeaders(info);
    if (interceptDetails) {
      const request = requests.get(info.requestId) || {};
      requests.delete(info.requestId);

      const download = {
        url: info.url,
        finalUrl: info.url,
        filename: interceptDetails.filename || request.filename || null,
        fileSize: interceptDetails.fileSize || request.fileSize || -1,
        mime: interceptDetails.mimeType || request.mimeType || null,
        referrer: request.referrer || null,
        requestHeaders: request.requestHeaders || null
      };

      intercepted.add(info.requestId);
      markInterceptedUrl(info.url);
      void sendToApp(download).finally(() => setTimeout(() => intercepted.delete(info.requestId), 5000));

      return { cancel: true };
    }

    const request = requests.get(info.requestId);
    requests.delete(info.requestId);
    if (!request) return;
    let fileSize = null, mimeType = null;
    for (const header of info.responseHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === "content-length") fileSize = Number(header.value) || null;
      if (name === "content-type") mimeType = header.value || null;
    }
    recentHeaders.set(info.url, { ...request, fileSize, mimeType });
    setTimeout(() => recentHeaders.delete(info.url), 30000);
  }, { urls: ["<all_urls>"] }, ["blocking", "responseHeaders"]);
  registered = true;
} catch (e) {
  // Failed to register blocking (e.g. Chrome MV3)
}

if (!registered) {
  try {
    chrome.webRequest.onHeadersReceived.addListener(info => {
      const request = requests.get(info.requestId);
      requests.delete(info.requestId);
      if (!request) return;
      let fileSize = null, mimeType = null;
      for (const header of info.responseHeaders || []) {
        const name = header.name.toLowerCase();
        if (name === "content-length") fileSize = Number(header.value) || null;
        if (name === "content-type") mimeType = header.value || null;
      }
      recentHeaders.set(info.url, { ...request, fileSize, mimeType });
      setTimeout(() => recentHeaders.delete(info.url), 30000);
    }, { urls: ["<all_urls>"] }, ["responseHeaders", "extraHeaders"]);
  } catch (e) {
    chrome.webRequest.onHeadersReceived.addListener(info => {
      const request = requests.get(info.requestId);
      requests.delete(info.requestId);
      if (!request) return;
      let fileSize = null, mimeType = null;
      for (const header of info.responseHeaders || []) {
        const name = header.name.toLowerCase();
        if (name === "content-length") fileSize = Number(header.value) || null;
        if (name === "content-type") mimeType = header.value || null;
      }
      recentHeaders.set(info.url, { ...request, fileSize, mimeType });
      setTimeout(() => recentHeaders.delete(info.url), 30000);
    }, { urls: ["<all_urls>"] }, ["responseHeaders"]);
  }
}

chrome.webRequest.onErrorOccurred.addListener(info => requests.delete(info.requestId), { urls: ["<all_urls>"] });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: MENU_ID, title: "Baixar com SF Downloader", contexts: ["link", "video", "audio", "image"] }));
  chrome.storage.local.get("captureEnabled", result => {
    if (result.captureEnabled === undefined) {
      captureEnabledState = true;
      chrome.storage.local.set({ captureEnabled: true });
    } else {
      captureEnabledState = result.captureEnabled;
    }
  });
  void syncBridge();
});

chrome.runtime.onStartup.addListener(() => void syncBridge());
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.captureEnabled) {
    captureEnabledState = changes.captureEnabled.newValue !== false;
  }
  if (changes.disabledExtensions) {
    disabledExtensionsState = changes.disabledExtensions.newValue || [];
    bridge.fileExts = applyExtensionFilters(bridge.allFileExts || bridge.fileExts, disabledExtensionsState);
  }
});
chrome.alarms.create("sf-bridge-sync", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "sf-bridge-sync") void syncBridge(); });

const determiningFilename = chrome.downloads?.["onDeterminingFilename"];
if (determiningFilename) {
  determiningFilename.addListener(onDeterminingFilename);
} else if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(download => {
    const url = download.finalUrl || download.url;
    syncBridge().then(() => {
      if (!captureEnabledState || intercepted.has(download.id) || !shouldTakeOver(url, download.filename)) return;
      intercepted.add(download.id);
      eraseDownload(download.id);
      void sendToApp(download).finally(() => setTimeout(() => intercepted.delete(download.id), 5000));
    }).catch(() => {});
  });
}

if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(delta => {
    if (delta.state && (delta.state.current === "interrupted" || delta.state.current === "complete")) {
      if (intercepted.has(delta.id)) {
        chrome.downloads.erase({ id: delta.id }, () => void chrome.runtime.lastError);
      }
    }
  });
}

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!validUrl(url)) return;
  if (bridge.connected) void sendToApp({ url, finalUrl: url, filename: null, fileSize: -1, mime: null, referrer: info.pageUrl });
  else void launchProtocol(url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "intercept-link") {
    syncBridge().then(() => {
      const handled = captureEnabledState && shouldTakeOver(message.url, message.filename);
      if (!handled) {
        sendResponse({ handled: false });
        return;
      }
      sendToApp({
        url: message.url,
        finalUrl: message.url,
        filename: message.filename || null,
        fileSize: -1,
        mime: null,
        referrer: message.referrer || null
      }).then(() => sendResponse({ handled: true }))
        .catch(() => sendResponse({ handled: false }));
    }).catch(() => {
      sendResponse({ handled: false });
    });
    return true;
  }
  if (message?.type === "capture-toggled") {
    captureEnabledState = message.enabled !== false;
    void syncBridge().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "extension-filters-updated") {
    disabledExtensionsState = message.disabledExtensions || [];
    bridge.fileExts = applyExtensionFilters(bridge.allFileExts || bridge.fileExts, disabledExtensionsState);
    saveBridgeToStorage();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "bridge-status") {
    chrome.storage.local.get("captureEnabled", ({ captureEnabled = true }) => {
      if (!captureEnabled) {
        sendResponse({ connected: false });
      } else {
        void syncBridge().finally(() => sendResponse({ connected: bridge.connected }));
      }
    });
    return true;
  }
  if (message?.type !== "send-to-app") return;
  const task = bridge.connected
    ? sendToApp({ url: message.url, finalUrl: message.url, filename: null, fileSize: -1, mime: null, referrer: null })
    : launchProtocol(message.url);
  task.then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

void syncBridge();
