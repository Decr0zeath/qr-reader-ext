// Runs in every page while auto-scan is on and asks background.js for a scan
// whenever what's on screen may have changed. It never scans on a timer,
// except while a video is playing.

// Re-injecting replaces the previous instance, like overlay.js.
globalThis.qrWatch?.stop();

globalThis.qrWatch = (() => {
  const isTop = window === top;
  // Same defaults as lib/settings.js.
  let settings = { autoScan: false, videoInterval: 2, excludedSites: [] };
  let pending = null;
  let videoTimer = null;
  let observer = null;
  const abort = new AbortController();
  const { signal } = abort;

  // Only the top frame knows the site the user is on; background.js checks
  // the site for requests from embedded frames.
  const enabled = () =>
    settings.autoScan && !(isTop && settings.excludedSites.includes(location.hostname));

  // Debounced, so a burst of changes (scrolling, images loading in) leads to
  // one scan once things settle. background.js also caps scans at one per
  // second per tab.
  function request(delay) {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (!enabled() || document.hidden || globalThis.qrReader?.showingResults()) return;
      try {
        chrome.runtime.sendMessage({ type: "auto-scan" }).catch(() => {});
      } catch {
        // The extension was reloaded or removed, so this copy is orphaned.
        stop();
      }
    }, delay);
  }

  function updateVideoTimer() {
    const playing =
      enabled() &&
      !document.hidden &&
      [...document.querySelectorAll("video")].some((video) => !video.paused && !video.ended);
    if (playing && !videoTimer) {
      videoTimer = setInterval(() => request(0), settings.videoInterval * 1000);
    } else if (!playing && videoTimer) {
      clearInterval(videoTimer);
      videoTimer = null;
    }
  }

  function apply(next) {
    const wasEnabled = enabled();
    settings = next;
    // Restart the timer in case the interval changed.
    clearInterval(videoTimer);
    videoTimer = null;
    updateVideoTimer();
    if (!enabled()) globalThis.qrReader?.clearMarkers();
    else if (!wasEnabled) request(0);
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    const next = { ...settings };
    for (const [key, { newValue }] of Object.entries(changes)) if (key in next) next[key] = newValue;
    apply(next);
  }

  function stop() {
    abort.abort();
    observer?.disconnect();
    clearTimeout(pending);
    clearInterval(videoTimer);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // Orphaned after an extension reload; nothing left to remove.
    }
  }

  // Media events don't bubble, so listen in the capture phase.
  for (const type of ["play", "pause", "ended", "emptied"]) {
    document.addEventListener(type, updateVideoTimer, { capture: true, signal });
  }
  document.addEventListener("visibilitychange", updateVideoTimer, { signal });

  // Embedded frames only report videos; everything else about the screen is
  // visible from the top frame.
  if (isTop) {
    // Capturing on window also catches scrolling inside page elements.
    addEventListener("scroll", () => request(300), { capture: true, passive: true, signal });
    addEventListener("resize", () => request(300), { signal });
    document.addEventListener("visibilitychange", () => request(0), { signal });
    document.addEventListener("load", (e) => e.target instanceof HTMLImageElement && request(500), {
      capture: true,
      signal,
    });

    // New or changed images, canvases, videos and frames may hold QR codes.
    // Text and style changes are ignored to keep busy pages cheap.
    const MEDIA = "img, picture, svg, canvas, video, iframe, object, embed";
    observer = new MutationObserver((records) => {
      const media = records.some(
        (r) =>
          r.type === "attributes" ||
          [...r.addedNodes].some((n) => n instanceof Element && (n.matches(MEDIA) || n.querySelector(MEDIA))),
      );
      if (media) request(500);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.storage.local.get(settings).then(apply);

  // refresh() lets overlay.js bring the markers back after the results of a
  // click are dismissed.
  return { stop, refresh: () => request(0) };
})();
