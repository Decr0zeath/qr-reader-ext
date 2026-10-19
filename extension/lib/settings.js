// Settings shared by background.js and the options page. watch.js keeps its
// own copy of the defaults because content scripts can't import modules.
export const DEFAULTS = { autoScan: false, videoInterval: 2, excludedSites: [] };

// Auto-scan needs to screenshot and inject into any page without a click.
export const ALL_SITES = { origins: ["<all_urls>"] };

export function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

// Call this straight from a click: turning auto-scan on asks for access to
// all sites, and Chrome only shows that prompt in response to a user action.
// Resolves to whether auto-scan ended up on.
export async function setAutoScan(on) {
  if (on && !(await chrome.permissions.request(ALL_SITES))) return false;
  await chrome.storage.local.set({ autoScan: on });
  // Hand the access back when auto-scan no longer needs it.
  if (!on) await chrome.permissions.remove(ALL_SITES);
  return on;
}

export async function setSiteExcluded(site, excluded) {
  const { excludedSites } = await getSettings();
  const others = excludedSites.filter((s) => s !== site);
  await chrome.storage.local.set({ excludedSites: excluded ? [...others, site].sort() : others });
}

// The hostname that per-site settings are keyed by, or null for pages
// auto-scan never runs on.
export function siteOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? hostname : null;
  } catch {
    return null;
  }
}
