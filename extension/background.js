import { prepareZXingModule, readBarcodes } from "./vendor/zxing-wasm/reader/index.js";
import { describe } from "./lib/describe.js";

// Load the decoder from the extension package instead of the library's
// default CDN, so no code is fetched at runtime.
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith(".wasm") ? chrome.runtime.getURL(`vendor/zxing-wasm/${path}`) : prefix + path,
  },
});

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
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
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
