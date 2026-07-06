const bypassedLinks = new WeakSet();

function resumeNavigation(anchor) {
  bypassedLinks.add(anchor);
  anchor.click();
  queueMicrotask(() => bypassedLinks.delete(anchor));
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0) return;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!anchor || bypassedLinks.has(anchor)) return;
  const url = anchor.href;
  if (!/^https?:\/\//i.test(url)) return;

  const filename = anchor.getAttribute("download") || null;
  event.preventDefault();
  event.stopImmediatePropagation();

  chrome.runtime.sendMessage({
    type: "intercept-link",
    url,
    filename,
    referrer: location.href
  }).then(response => {
    if (!response?.handled) resumeNavigation(anchor);
  }).catch(() => resumeNavigation(anchor));
}, true);
