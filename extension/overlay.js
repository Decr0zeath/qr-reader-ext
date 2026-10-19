// Draws scan results over the page. background.js injects this file before
// every scan, then calls the functions on `globalThis.qrReader`. It runs in
// the extension's isolated world, so page scripts can't reach it.

// Re-injecting replaces the previous instance, so an updated extension
// never keeps running old overlay code in a tab that was open before.
globalThis.qrReader?.clear();

globalThis.qrReader = (() => {
  const GAP = 8; // Space between a code and its card, and from the viewport edges.
  const STYLE = `
    * { box-sizing: border-box; }
    .layer, svg { position: absolute; inset: 0; }
    svg { width: 100%; height: 100%; overflow: visible; }
    .halo { fill: none; stroke: rgb(0 0 0 / 0.55); stroke-width: 6; stroke-linejoin: round; }
    .edge { fill: rgb(74 222 128 / 0.14); stroke: #4ade80; stroke-width: 3; stroke-linejoin: round; }
    .edge.active { fill: rgb(74 222 128 / 0.32); stroke-width: 5; }

    .list {
      position: absolute;
      top: 48px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: calc(100% - 48px);
      /* Padding instead of an offset, so card shadows aren't clipped. */
      padding: 8px 12px 16px;
      overflow: auto;
      pointer-events: auto;
    }
    .list.left { left: 0; }
    .list.right { right: 0; }
    /* A tighter shadow that fits inside the list's padding. */
    .list .card { position: static; flex: none; box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); }

    .card, .bar {
      pointer-events: auto;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #f4f4f5;
      background: #18181b;
      border: 1px solid rgb(255 255 255 / 0.12);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    }
    .card {
      position: absolute;
      width: min(320px, calc(100vw - ${GAP * 2}px));
      padding: 10px 12px 12px;
      border-radius: 10px;
    }
    .kind {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #a1a1aa;
    }
    .num, .tag {
      display: inline-grid;
      place-items: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      font: 700 11px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #052e16;
      background: #4ade80;
    }
    .tag { position: absolute; box-shadow: 0 0 0 2px rgb(0 0 0 / 0.55); }
    .host { margin-top: 4px; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .url {
      margin-top: 2px;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      color: #a1a1aa;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .text {
      margin-top: 4px;
      max-height: 9.8em;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .actions { display: flex; gap: 8px; margin-top: 10px; }

    .button {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border: 1px solid rgb(255 255 255 / 0.18);
      border-radius: 7px;
      font: inherit;
      font-weight: 600;
      color: inherit;
      background: transparent;
      text-decoration: none;
      cursor: pointer;
    }
    .button:hover { background: rgb(255 255 255 / 0.08); }
    .button.primary { color: #052e16; background: #4ade80; border-color: #4ade80; }
    .button.primary:hover { background: #86efac; border-color: #86efac; }
    .button:focus-visible, .close:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }

    .bar {
      position: absolute;
      top: 12px;
      left: 50%;
      translate: -50% 0;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: calc(100vw - ${GAP * 2}px);
      padding: 5px 5px 5px 14px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .hint { color: #a1a1aa; }
    kbd {
      padding: 1px 5px;
      border: 1px solid rgb(255 255 255 / 0.18);
      border-radius: 4px;
      font: inherit;
      font-size: 11px;
    }
    .close {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      font: 16px/1 system-ui, sans-serif;
      color: #a1a1aa;
      background: rgb(255 255 255 / 0.08);
      cursor: pointer;
    }
    .close:hover { color: #f4f4f5; background: rgb(255 255 255 / 0.16); }

    @media (prefers-reduced-motion: no-preference) {
      .card, .bar, .tag, svg { animation: enter 0.16s ease-out; }
      @keyframes enter { from { opacity: 0; transform: translateY(4px); } }
    }
  `;

  // The scan currently on screen: its host element and a controller whose
  // abort() removes every listener it added.
  let current = null;

  function teardown() {
    if (!current) return;
    current.abort.abort();
    current.host.remove();
    current = null;
  }

  // Async so callers can wait until the removal has been painted and won't
  // capture the old overlay in a fresh screenshot.
  function clear() {
    teardown();
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      setTimeout(resolve, 100);
    });
  }

  function mount() {
    teardown();
    const host = document.createElement("qr-reader-overlay");
    host.setAttribute(
      "style",
      "all: initial !important; position: fixed !important; inset: 0 !important;" +
        "z-index: 2147483647 !important; pointer-events: none !important;",
    );
    const root = host.attachShadow({ mode: "closed" });
    root.append(el("style", { textContent: STYLE }));
    document.documentElement.append(host);
    // The top layer keeps the overlay above modal dialogs and fullscreen video.
    if (host.showPopover) {
      host.popover = "manual";
      host.showPopover();
    }

    const abort = new AbortController();
    const { signal } = abort;
    current = { host, root, abort };
    addEventListener("keydown", (e) => e.key === "Escape" && teardown(), { capture: true, signal });
    addEventListener("pointerdown", (e) => !e.composedPath().includes(host) && teardown(), {
      capture: true,
      signal,
    });
    // The outlines are only valid for the layout they were measured against.
    addEventListener("resize", teardown, { signal });
    return current;
  }

  function status(message, autoHideMs) {
    const scan = mount();
    scan.root.append(bar(message));
    if (autoHideMs) setTimeout(() => current === scan && teardown(), autoHideMs);
  }

  function show(codes) {
    if (codes.length === 0) return status("No QR codes found", 2500);

    const scan = mount();
    const width = innerWidth;
    const height = innerHeight;
    const items = codes
      .map((code) => {
        const points = code.corners.map(([x, y]) => [x * width, y * height]);
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        const box = {
          left: Math.min(...xs),
          right: Math.max(...xs),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
        };
        return { code, points, box };
      })
      // Number codes in reading order: by row, then left to right.
      .sort((a, b) => {
        const sameRow = Math.abs(a.box.top - b.box.top) < (a.box.bottom - a.box.top) / 2;
        return sameRow ? a.box.left - b.box.left : a.box.top - b.box.top;
      });

    const numbered = items.length > 1;
    const layer = el("div", { className: "layer" });
    const svg = svgEl("svg");
    layer.append(svg);
    items.forEach((item, i) => {
      const points = item.points.map((p) => p.join(",")).join(" ");
      const edge = svgEl("polygon", { class: "edge", points });
      svg.append(svgEl("polygon", { class: "halo", points }), edge);
      if (numbered) {
        // Tag the corner nearest the top left of the screen, even when rotated.
        const [x, y] = item.points.reduce((a, b) => (b[0] + b[1] < a[0] + a[1] ? b : a));
        const tag = el("span", { className: "tag", textContent: String(i + 1) });
        tag.style.left = `${x - 9}px`;
        tag.style.top = `${y - 9}px`;
        layer.append(tag);
      }
      item.card = card(item.code, numbered ? i + 1 : null);
      item.card.style.visibility = "hidden";
      // Highlight the code whose card is being pointed at or focused.
      const highlight = (on) => () => edge.classList.toggle("active", on);
      item.card.addEventListener("pointerenter", highlight(true));
      item.card.addEventListener("pointerleave", highlight(false));
      item.card.addEventListener("focusin", highlight(true));
      item.card.addEventListener("focusout", highlight(false));
      layer.append(item.card);
    });

    const n = items.length;
    const summary = bar(
      `${n} QR code${n === 1 ? "" : "s"} found`,
      el("span", { className: "hint" }, "Press ", el("kbd", {}, "Esc"), " to close"),
    );
    scan.root.append(layer, summary);

    if (placeCards(items, width, height, [rect(summary), ...items.map(({ box }) => boxRect(box))])) {
      for (const item of items) item.card.style.visibility = "";
    } else {
      // Not enough room to put every card beside its code: list them along
      // the side of the screen that covers fewer codes.
      const onLeft = items.filter(({ box }) => (box.left + box.right) / 2 < width / 2).length;
      const side = onLeft > items.length / 2 ? "right" : "left";
      const list = el("div", { className: `list ${side}` });
      for (const item of items) {
        item.card.removeAttribute("style");
        list.append(item.card);
      }
      scan.root.append(list);
    }

    // Keep the outlines on their codes when the page scrolls.
    const startX = scrollX;
    const startY = scrollY;
    addEventListener(
      "scroll",
      () => (layer.style.transform = `translate(${startX - scrollX}px, ${startY - scrollY}px)`),
      { passive: true, signal: scan.abort.signal },
    );
  }

  function card(code, number) {
    const kind = el("div", { className: "kind" });
    if (number) kind.append(el("span", { className: "num" }, String(number)));
    const copyButton = el("button", { className: "button", type: "button" }, "Copy");
    copyButton.addEventListener("click", async () => {
      const copied = await copy(code.text);
      copyButton.textContent = copied ? "Copied" : "Copy failed";
      setTimeout(() => (copyButton.textContent = "Copy"), 1500);
    });

    if (code.kind === "link") {
      kind.append("Link");
      const open = el(
        "a",
        { className: "button primary", href: code.href, target: "_blank", rel: "noopener noreferrer" },
        "Open link ↗",
      );
      return el(
        "div",
        { className: "card" },
        kind,
        el("div", { className: "host" }, code.host),
        el("div", { className: "url", title: code.href }, code.href),
        el("div", { className: "actions" }, open, copyButton),
      );
    }

    kind.append("Text");
    copyButton.classList.add("primary");
    return el(
      "div",
      { className: "card" },
      kind,
      el("div", { className: "text" }, code.text),
      el("div", { className: "actions" }, copyButton),
    );
  }

  // Puts each card next to its code (below, above, right or left, in that
  // order of preference) where it stays on screen and covers neither a code
  // nor another card. Returns false if some card has no such spot.
  function placeCards(items, width, height, obstacles) {
    const taken = [...obstacles];
    for (const { card, box } of items) {
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const centered = clamp((box.left + box.right) / 2 - w / 2, GAP, width - w - GAP);
      const level = clamp(box.top, GAP, height - h - GAP);
      const spot = [
        { left: centered, top: box.bottom + GAP },
        { left: centered, top: box.top - GAP - h },
        { left: box.right + GAP, top: level },
        { left: box.left - GAP - w, top: level },
      ]
        .map((p) => ({ ...p, w, h }))
        .find(
          (r) =>
            r.left >= GAP &&
            r.top >= GAP &&
            r.left + w <= width - GAP &&
            r.top + h <= height - GAP &&
            !taken.some((t) => intersects(t, r)),
        );
      if (!spot) return false;
      taken.push(spot);
      card.style.left = `${spot.left}px`;
      card.style.top = `${spot.top}px`;
    }
    return true;
  }

  function bar(message, ...extra) {
    const close = el("button", { className: "close", type: "button", ariaLabel: "Close" }, "×");
    close.addEventListener("click", teardown);
    return el("div", { className: "bar", role: "status" }, el("span", {}, message), ...extra, close);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The async clipboard API is unavailable on insecure pages and can be
      // blocked by permissions policy, so fall back to the legacy command.
      const area = el("textarea", { value: text });
      area.style.cssText = "position: fixed; opacity: 0;";
      current?.root.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    }
  }

  function el(tag, props, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function rect(node) {
    const { left, top, width: w, height: h } = node.getBoundingClientRect();
    return { left, top, w, h };
  }

  function boxRect({ left, top, right, bottom }) {
    return { left, top, w: right - left, h: bottom - top };
  }

  function intersects(a, b) {
    return a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;
  }

  return { clear, status, show };
})();
