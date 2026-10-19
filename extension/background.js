import { prepareZXingModule, readBarcodes } from "./vendor/zxing-wasm/reader/index.js";
import { describe } from "./lib/describe.js";
import { ALL_SITES, getSettings, setAutoScan, setSiteExcluded, siteOf } from "./lib/settings.js";

// Load the decoder from the extension package instead of the library's
// default CDN, so no code is fetched at runtime.
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith(".wasm") ? chrome.runtime.getURL(`vendor/zxing-wasm/${path}`) : prefix + path,
  },
});

// JPEG takes about half the time of PNG to capture and decodes just as well.
const CAPTURE = { format: "jpeg", quality: 85 };

// Items in the toolbar icon's right-click menu.
const MENU = { autoScan: "auto-scan", site: "auto-scan-site" };

// Scanning on click (or the keyboard shortcut).

const scanning = new Set();

chrome.action.onClicked.addListener(async (tab) => {
  if (scanning.has(tab.id)) return;
  scanning.add(tab.id);
  try {
    await scan(tab);
  } finally {
    scanning.delete(tab.id);
  }
});

async function scan(tab) {
  const target = { tabId: tab.id };
  try {
    await chrome.scripting.executeScript({ target, files: ["overlay.js"] });
  } catch {
    // Chrome blocks extensions on its own pages and the Web Store.
    return flagUnscannable(tab.id);
  }

  try {
    // Remove results from an earlier scan so they aren't in the screenshot.
    await callOverlay(target, "clear");
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, CAPTURE);
    await callOverlay(target, "status", "Scanning…");
    await callOverlay(target, "show", await findCodes(screenshot));
  } catch (error) {
    // Usually the tab navigated mid-scan, possibly to a page we can't access.
    console.warn("QR scan failed:", error);
    await callOverlay(target, "status", "Couldn't scan this page", 4000).catch(() =>
      flagUnscannable(tab.id),
    );
  }
}

// Auto-scan: watch.js runs in every page and asks for a scan when what's on
// screen may have changed.

const WATCHER = {
  id: "watch",
  matches: ["<all_urls>"],
  js: ["watch.js"],
  allFrames: true,
  runAt: "document_idle",
};
const MIN_GAP_MS = 1000;
const autoScans = new Map(); // tabId -> { last, timer, running, again }

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "auto-scan" && sender.tab) queueAutoScan(sender.tab.id);
});
chrome.tabs.onRemoved.addListener((tabId) => autoScans.delete(tabId));

// At most one scan per second per tab. Requests in between are merged.
function queueAutoScan(tabId) {
  const state = autoScans.get(tabId) ?? { last: 0, timer: null, running: false, again: false };
  autoScans.set(tabId, state);
  if (state.running) {
    state.again = true;
  } else if (!state.timer) {
    const wait = Math.max(0, state.last + MIN_GAP_MS - Date.now());
    state.timer = setTimeout(() => runAutoScan(tabId, state), wait);
  }
}

async function runAutoScan(tabId, state) {
  state.timer = null;
  state.running = true;
  state.last = Date.now();
  try {
    await autoScan(tabId);
  } catch (error) {
    // Usually the tab closed or navigated mid-scan; its next change retries.
    console.warn("Auto-scan failed:", error);
  } finally {
    state.running = false;
    if (state.again) {
      state.again = false;
      queueAutoScan(tabId);
    }
  }
}

async function autoScan(tabId) {
  const [settings, tab] = await Promise.all([getSettings(), chrome.tabs.get(tabId)]);
  if (!settings.autoScan || !tab.active || settings.excludedSites.includes(siteOf(tab.url))) return;
  // Skip windows in the background: the user isn't looking at them.
  if (!(await chrome.windows.get(tab.windowId)).focused) return;

  const target = { tabId };
  const [{ result: showingResults }] = await chrome.scripting.executeScript({
    target,
    func: () => globalThis.qrReader?.showingResults() ?? null,
  });
  // The results of a click are on screen; leave them alone.
  if (showingResults) return;
  if (showingResults === null) await chrome.scripting.executeScript({ target, files: ["overlay.js"] });

  const codes = await findCodes(await chrome.tabs.captureVisibleTab(tab.windowId, CAPTURE));
  await callOverlay(target, "mark", codes);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#16a34a" });
  await chrome.action.setBadgeText({ tabId, text: codes.length ? String(codes.length) : "" });
}

// The auto-scan setting lives in storage, changed from the menu below or the
// options page. This keeps the watcher, open tabs and menu in line with it.

let syncing = Promise.resolve();
function syncAutoScan() {
  syncing = syncing.then(applyAutoScan).catch((error) => console.warn("Auto-scan sync failed:", error));
  return syncing;
}

async function applyAutoScan() {
  const { autoScan } = await getSettings();
  const on = autoScan && (await chrome.permissions.contains(ALL_SITES));
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [WATCHER.id] });
  if (on && registered.length === 0) {
    await chrome.scripting.registerContentScripts([WATCHER]);
    // Pages opened before auto-scan was turned on need the watcher too.
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.all(
      tabs.map((tab) =>
        chrome.scripting
          .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["watch.js"] })
          .catch(() => {}),
      ),
    );
  } else if (!on && registered.length > 0) {
    // Watchers already in pages see the setting change and remove their markers.
    await chrome.scripting.unregisterContentScripts({ ids: [WATCHER.id] });
    await clearBadges(() => true);
  }
  await chrome.contextMenus.update(MENU.autoScan, { checked: on });
  await updateSiteMenu();
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU.autoScan,
    title: "Auto-scan pages",
    type: "checkbox",
    contexts: ["action"],
  });
  chrome.contextMenus.create({
    id: MENU.site,
    title: "Auto-scan on this site",
    type: "checkbox",
    contexts: ["action"],
    visible: false,
  });
  // Start fresh, so open tabs get this version's watcher in place of an
  // older one.
  await chrome.scripting.unregisterContentScripts();
  await syncAutoScan();
});
chrome.runtime.onStartup.addListener(syncAutoScan);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if ("autoScan" in changes) syncAutoScan();
  if ("excludedSites" in changes) {
    const excluded = changes.excludedSites.newValue ?? [];
    await clearBadges((tab) => excluded.includes(siteOf(tab.url)));
    await updateSiteMenu();
  }
});

chrome.permissions.onRemoved.addListener(async () => {
  // Site access can also be taken away from chrome://extensions.
  if (!(await chrome.permissions.contains(ALL_SITES))) await chrome.storage.local.set({ autoScan: false });
  syncAutoScan();
});

// Right-click menu on the toolbar icon.

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU.autoScan) {
    // Called without awaiting anything first, so the permission prompt
    // still counts as a response to the click. Syncing afterwards unticks
    // the item if access was refused.
    setAutoScan(info.checked).then(syncAutoScan);
  } else if (info.menuItemId === MENU.site) {
    const site = siteOf(tab?.url);
    if (site) setSiteExcluded(site, !info.checked);
  }
});

// The per-site item names the active tab's site, so it follows tab changes.
chrome.tabs.onActivated.addListener(updateSiteMenu);
chrome.windows.onFocusChanged.addListener(updateSiteMenu);
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url && tab.active) updateSiteMenu();
});

async function updateSiteMenu() {
  const [{ autoScan, excludedSites }, [tab]] = await Promise.all([
    getSettings(),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);
  const site = siteOf(tab?.url);
  await chrome.contextMenus
    .update(MENU.site, {
      visible: autoScan && site !== null,
      checked: !excludedSites.includes(site),
      title: site ? `Auto-scan on ${site}` : "Auto-scan on this site",
    })
    .catch(() => {});
}

// Shared helpers.

function callOverlay(target, method, ...args) {
  return chrome.scripting.executeScript({
    target,
    // `qrReader` is missing if the tab navigated since overlay.js was injected.
    func: (method, args) => globalThis.qrReader?.[method](...args),
    args: [method, args],
  });
}

async function findCodes(screenshotUrl) {
  const bitmap = await createImageBitmap(await (await fetch(screenshotUrl)).blob());
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext("2d");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const results = await readBarcodes(context.getImageData(0, 0, width, height), {
    formats: ["QRCode"],
  });
  return results
    .filter((result) => result.isValid)
    .map(({ text, position: p }) => ({
      text,
      ...describe(text),
      // Corners as fractions of the screenshot size, so the overlay can map
      // them to CSS pixels whatever the device pixel ratio or zoom level.
      corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map(({ x, y }) => [
        x / width,
        y / height,
      ]),
    }));
}

async function clearBadges(match) {
  for (const tab of await chrome.tabs.query({})) {
    if (match(tab)) await chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
  }
}

async function flagUnscannable(tabId) {
  const { default_title } = chrome.runtime.getManifest().action;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({ tabId, title: "QR Reader can't run on this page" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: default_title }).catch(() => {});
  }, 4000);
}
