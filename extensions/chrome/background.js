// MV3 service worker — sets up the right-click-on-image entry point and
// relays the clicked image's URL to the side panel. No image bytes ever
// pass through this file: the side panel hands the URL straight to
// /api/analyze/image-url, which downloads and validates it server-side
// (lib/net/safeFetch.ts already does the SSRF/size/content-type checks —
// duplicating that here would just be a second, weaker copy of the same logic).

const MENU_ID = "imalytix-analyze-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Imalytix로 이 이미지 분석하기",
    contexts: ["image"],
  });
});

// Clicking the toolbar icon opens the side panel directly (empty state —
// paste a URL manually) instead of toggling a popup.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error("[imalytix] setPanelBehavior failed", err));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl || !tab?.windowId) return;

  // chrome.sidePanel.open() only works when called synchronously inside a
  // user-gesture event handler (a context-menu click counts, but only up
  // until the first `await` — Chrome throws "may only be called in response
  // to a user gesture" once that window closes). It has to go first, before
  // any awaited call, even a fast one like storage.session.set().
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.error("[imalytix] sidePanel.open failed", err));

  // chrome.storage.session (not runtime.sendMessage) — the side panel may
  // not be open/listening yet when this fires, so a message would be lost.
  // Storage persists the pending request until the panel reads it on load.
  // Ordered after open() above, but sidepanel.js reads this on its own load
  // (a separate, slower async chain than this handler returning), so the
  // write reliably lands before the panel's consumePendingRequest() runs.
  chrome.storage.session.set({
    imalytixPendingImageUrl: info.srcUrl,
    imalytixPendingAt: Date.now(),
  });
});
