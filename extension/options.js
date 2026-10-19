import { getSettings, setAutoScan, setSiteExcluded } from "./lib/settings.js";

const toggle = document.getElementById("auto-scan");
const denied = document.getElementById("denied");
const options = document.getElementById("auto-scan-options");
const sites = document.getElementById("sites");
const noSites = document.getElementById("no-sites");

async function render() {
  const settings = await getSettings();
  toggle.checked = settings.autoScan;
  options.disabled = !settings.autoScan;
  for (const radio of document.querySelectorAll('input[name="interval"]')) {
    radio.checked = Number(radio.value) === settings.videoInterval;
  }

  noSites.hidden = settings.excludedSites.length > 0;
  sites.replaceChildren(
    ...settings.excludedSites.map((site) => {
      const remove = Object.assign(document.createElement("button"), {
        type: "button",
        textContent: "Turn back on",
      });
      remove.setAttribute("aria-label", `Turn auto-scan back on for ${site}`);
      remove.addEventListener("click", () => setSiteExcluded(site, false));
      const item = document.createElement("li");
      item.append(Object.assign(document.createElement("span"), { textContent: site }), remove);
      return item;
    }),
  );
}

toggle.addEventListener("change", async () => {
  // setAutoScan() has to run straight from the click for Chrome to show
  // its permission prompt.
  const wanted = toggle.checked;
  const on = await setAutoScan(wanted);
  denied.hidden = on || !wanted;
  render();
});

for (const radio of document.querySelectorAll('input[name="interval"]')) {
  radio.addEventListener("change", () => chrome.storage.local.set({ videoInterval: Number(radio.value) }));
}

// Stay in sync with changes made from the right-click menu.
chrome.storage.onChanged.addListener(render);
render();
