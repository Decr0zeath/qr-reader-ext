// Draws scan results over the page. background.js injects this file and then
// calls the functions on `globalThis.qrReader`: show() for the results of a
// click, mark() for auto-scan. It runs in the extension's isolated world, so
// page scripts can't reach it.

// Re-injecting replaces the previous instance, so an updated extension
// never keeps running old overlay code in a tab that was open before.
globalThis.qrReader?.clear();

globalThis.qrReader = (() => {
  const GAP = 8; // Space between a code and its card, and from the viewport edges.
  // How far auto-scan brackets sit outside a code, so they don't stop the
  // next screenshot from decoding it.
  const BRACKET_OFFSET = 7;
  const STYLE = `
    * { box-sizing: border-box; }
    .layer, svg { position: absolute; inset: 0; }
    svg { width: 100%; height: 100%; overflow: visible; }
    .halo { fill: none; stroke: rgb(0 0 0 / 0.55); stroke-width: 6; stroke-linejoin: round; }
    .edge { fill: rgb(74 222 128 / 0.14); stroke: #4ade80; stroke-width: 3; stroke-linejoin: round; }
    .edge.active { fill: rgb(74 222 128 / 0.32); stroke-width: 5; }
    .bracket, .edge.bracket.active { fill: none; stroke-linecap: round; }
    .halo.bracket { stroke-width: 5; }
    .edge.bracket { stroke-width: 2.5; }
    .edge.bracket.active { stroke-width: 4; }

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
    .num, .tag, .chip {
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
    .tag, .chip { position: absolute; box-shadow: 0 0 0 2px rgb(0 0 0 / 0.55); }
    .chip {
      height: 20px;
      padding: 0 8px;
      border: 0;
      border-radius: 10px;
      pointer-events: auto;
      cursor: pointer;
    }
    .chip:hover { background: #86efac; }
    .chip[aria-expanded="true"] { background: #f4f4f5; }
    .chip:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }
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
      .card, .bar, .tag, .chip, svg { animation: enter 0.16s ease-out; }
      @keyframes enter { from { opacity: 0; transform: translateY(4px); } }
    }
    /* Markers redrawn for codes already on screen shouldn't animate in again. */
    .still, .still * { animation: none !important; }
  `;

  // What's on screen: its host element, its mode ("results" of a click or
  // auto-scan "markers"), and a controller whose abort() removes every
  // listener it added.
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

  // Closing the results of a click by hand lets auto-scan, if it's on, put
  // its markers back right away.
  function dismiss() {
    teardown();
    globalThis.qrWatch?.refresh();
  }

  function showingResults() {
    return current?.mode === "results";
  }

  function clearMarkers() {
    if (current?.mode === "markers") teardown();
  }

  function mount(mode) {
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
    current = { host, root, abort, mode };
    // The outlines are only valid for the layout they were measured against.
    addEventListener("resize", teardown, { signal: abort.signal });
    return current;
  }

  // Calls close() on Escape or on a click anywhere outside the overlay.
  function dismissOn(scan, close) {
    const { signal } = scan.abort;
    addEventListener("keydown", (e) => e.key === "Escape" && close(), { capture: true, signal });
    addEventListener("pointerdown", (e) => !e.composedPath().includes(scan.host) && close(), {
      capture: true,
      signal,
    });
  }

  function status(message, autoHideMs) {
    const scan = mount("results");
    dismissOn(scan, dismiss);
    scan.root.append(bar(message));
    if (autoHideMs) setTimeout(() => current === scan && dismiss(), autoHideMs);
  }

  function show(codes) {
    if (codes.length === 0) return status("No QR codes found", 2500);

    const scan = mount("results");
    dismissOn(scan, dismiss);
    const width = innerWidth;
    const height = innerHeight;
    const items = layout(codes, width, height);

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
      // Not enough room to put every card beside its code.
      scan.root.append(sideList(items, width));
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

  // Auto-scan results: brackets around each code and a chip that opens its
  // card. Unlike show(), it leaves the codes uncovered so the next screenshot
  // can still read them, and it never replaces the results of a click.
  // Returns true so background.js can tell the overlay is loaded.
  function mark(codes) {
    if (current?.mode === "results") return true;
    const previous = current?.mode === "markers" ? current : null;
    const signature = JSON.stringify(codes.map(({ text, corners }) => [text, corners]));
    if (previous && !previous.moved && previous.signature === signature) return true;
    if (codes.length === 0) {
      teardown();
      return true;
    }

    const scan = mount("markers");
    const texts = codes.map(({ text }) => text).sort().join("\n");
    Object.assign(scan, { signature, texts, moved: false, open: null });
    const width = innerWidth;
    const height = innerHeight;
    // Everything is placed around the brackets rather than the codes, so
    // cards and chips keep clear of both.
    const items = layout(codes, width, height).map((item) => {
      const corners = expand(item.points, BRACKET_OFFSET);
      return { ...item, corners, outer: bounds(corners) };
    });
    const boxes = items.map(({ outer }) => boxRect(outer));
    const layer = el("div", { className: previous?.texts === texts ? "layer still" : "layer" });
    const svg = svgEl("svg");
    layer.append(svg);
    scan.root.append(layer);

    const close = () => {
      if (!scan.open) return;
      scan.open.node.remove();
      scan.open.item.chip.ariaExpanded = "false";
      scan.open.item.edge.classList.remove("active");
      scan.open = null;
    };
    const open = (item) => {
      close();
      const node = card(item.code, null);
      node.style.visibility = "hidden";
      layer.append(node);
      const obstacles = [...boxes, ...items.map(({ chipRect }) => chipRect)];
      if (placeCards([{ card: node, box: item.outer }], width, height, obstacles)) {
        node.style.visibility = "";
        scan.open = { item, node };
      } else {
        scan.open = { item, node: sideList([{ card: node, box: item.outer }], width) };
        scan.root.append(scan.open.node);
      }
      item.chip.ariaExpanded = "true";
      item.edge.classList.add("active");
    };
    dismissOn(scan, close);

    for (const item of items) {
      const d = brackets(item.corners);
      item.edge = svgEl("path", { class: "edge bracket", d });
      svg.append(svgEl("path", { class: "halo bracket", d }), item.edge);
      const { kind, host, text } = item.code;
      item.chip = el(
        "button",
        { className: "chip", type: "button", title: kind === "link" ? host : text.slice(0, 200), ariaExpanded: "false" },
        kind === "link" ? "Link" : "Text",
      );
      item.chip.addEventListener("click", () => (scan.open?.item === item ? close() : open(item)));
      layer.append(item.chip);
      item.chipRect = placeChip(item.chip, item.outer, boxes, width, height);
    }

    // Keep the card that was open before this update, if its code is still here.
    const reopen = previous?.open && items.find(({ code }) => code.text === previous.open.item.code.text);
    if (reopen) open(reopen);

    const startX = scrollX;
    const startY = scrollY;
    addEventListener(
      "scroll",
      (e) => {
        scan.moved = true;
        if (e.target === document) {
          layer.style.transform = `translate(${startX - scrollX}px, ${startY - scrollY}px)`;
        } else {
          // Codes inside a scrolled element moved by an unknown amount: hide
          // the markers until the next scan puts them back.
          layer.style.visibility = "hidden";
        }
      },
      { capture: true, passive: true, signal: scan.abort.signal },
    );
    return true;
  }

  // Maps each code's corners to CSS pixels and sorts the codes in reading
  // order: by row, then left to right.
  function layout(codes, width, height) {
    return codes
      .map((code) => {
        const points = code.corners.map(([x, y]) => [x * width, y * height]);
        return { code, points, box: bounds(points) };
      })
      .sort((a, b) => {
        const sameRow = Math.abs(a.box.top - b.box.top) < (a.box.bottom - a.box.top) / 2;
        return sameRow ? a.box.left - b.box.left : a.box.top - b.box.top;
      });
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
        .find((r) => onScreen(r, width, height, GAP) && !taken.some((t) => intersects(t, r)));
      if (!spot) return false;
      taken.push(spot);
      card.style.left = `${spot.left}px`;
      card.style.top = `${spot.top}px`;
    }
    return true;
  }

  // Lists the cards along the side of the screen that covers fewer codes.
  function sideList(items, width) {
    const onLeft = items.filter(({ box }) => (box.left + box.right) / 2 < width / 2).length;
    const side = onLeft > items.length / 2 ? "right" : "left";
    const list = el("div", { className: `list ${side}` });
    for (const { card } of items) {
      card.removeAttribute("style");
      list.append(card);
    }
    return list;
  }

  // Puts a chip just outside the top-left of a code's brackets, or another
  // side if that one is off screen or would cover a code. Returns where it went.
  function placeChip(chip, box, boxes, width, height) {
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;
    const spot = [
      { left: box.left, top: box.top - h - 6 },
      { left: box.left, top: box.bottom + 6 },
      { left: box.left - w - 6, top: box.top },
      { left: box.right + 6, top: box.top },
    ]
      .map((p) => ({ ...p, w, h }))
      .find((r) => onScreen(r, width, height, 4) && !boxes.some((b) => intersects(b, r))) ?? {
      left: clamp(box.left, 4, width - w - 4),
      top: clamp(box.top - h - 6, 4, height - h - 4),
      w,
      h,
    };
    chip.style.left = `${spot.left}px`;
    chip.style.top = `${spot.top}px`;
    return spot;
  }

  // Moves each corner `distance` pixels further out from the code's center,
  // which pushes every edge of a square code out by that distance.
  function expand(points, distance) {
    const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
    return points.map(([x, y]) => {
      const length = Math.hypot(x - cx, y - cy) || 1;
      const shift = (distance * Math.SQRT2) / length;
      return [x + (x - cx) * shift, y + (y - cy) * shift];
    });
  }

  // An SVG path with an L-shaped bracket at each corner.
  function brackets(corners) {
    return corners
      .map((p, i) => {
        const toward = (q) => {
          const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          const arm = Math.min(16, length * 0.3) / length;
          return [p[0] + (q[0] - p[0]) * arm, p[1] + (q[1] - p[1]) * arm];
        };
        return `M${toward(corners.at(i - 1))} L${p} L${toward(corners[(i + 1) % corners.length])}`;
      })
      .join(" ");
  }

  function bar(message, ...extra) {
    const close = el("button", { className: "close", type: "button", ariaLabel: "Close" }, "×");
    close.addEventListener("click", dismiss);
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

  function bounds(points) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }

  function rect(node) {
    const { left, top, width: w, height: h } = node.getBoundingClientRect();
    return { left, top, w, h };
  }

  function boxRect({ left, top, right, bottom }) {
    return { left, top, w: right - left, h: bottom - top };
  }

  function onScreen(r, width, height, margin) {
    return r.left >= margin && r.top >= margin && r.left + r.w <= width - margin && r.top + r.h <= height - margin;
  }

  function intersects(a, b) {
    return a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;
  }

  return { clear, status, show, mark, showingResults, clearMarkers };
})();
