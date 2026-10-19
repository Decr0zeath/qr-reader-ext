# QR Reader Extension

A Chrome extension that finds QR codes on the screen, outlines them, and shows what they contain: an **Open link** button for web links, or the decoded text otherwise.

## Install

Requires [Node.js](https://nodejs.org/) to fetch the QR decoder.

1. `npm install`. This also copies the decoder into `extension/vendor/`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.

## Use

Click the toolbar icon or press **Alt+Shift+Q**. Change the shortcut at `chrome://extensions/shortcuts`.

- Each QR code in view is outlined. Its card shows the link's domain and full URL, or the text, with a **Copy** button.
- With several codes, they're numbered. If there isn't room for every card beside its code, the cards are listed along the side of the screen.
- **Esc**, the close button, or clicking anywhere on the page dismisses the overlay.
- Only `http` and `https` links get an **Open link** button. Anything else, such as `javascript:` or Wi-Fi credentials, is shown as text. Links open in a new tab without a referrer.

### Auto-scan (off by default)

Turn it on by right-clicking the toolbar icon and choosing **Auto-scan pages**, or from the extension's options. Chrome asks for access to all sites at that point. Turning auto-scan off gives that access back.

- QR codes are marked with corner brackets and a small **Link** or **Text** chip. Click the chip to see the card.
- The toolbar icon shows how many codes are on screen.
- To turn it off for one site, right-click the icon on that site and untick **Auto-scan on _site_**. The options page lists those sites.
- Clicking the icon still shows the full results, as above.

To keep it cheap, auto-scan doesn't run on a timer. It scans when a page loads, about 300 ms after scrolling stops, when the window is resized, when you switch to the tab, and when new images or videos appear. While a video is playing, it also scans every 2 seconds (or every second, set in the options). It skips tabs you can't see and windows that aren't focused, and it scans each tab at most once a second.

## How it works

- The extension takes a screenshot of the visible tab and decodes it locally with [zxing-wasm](https://github.com/Sec-ant/zxing-wasm). This works on images, canvases, videos and anything else drawn on the screen.
- Nothing leaves the browser. The decoder is bundled with the extension, and nothing is fetched at runtime. Screenshots are never stored.
- Without auto-scan, it only runs when you click the icon or press the shortcut. It uses the `activeTab` permission and doesn't have access to your sites otherwise.
- It can't run on Chrome's own pages (`chrome://…`) or the Chrome Web Store. The icon shows a red **!** there.

## Develop

- `extension/background.js` captures the tab, decodes it, and drives the overlay. It also manages auto-scan and the toolbar icon's right-click menu.
- `extension/overlay.js` draws the outlines, markers and cards. It's injected into the page on demand.
- `extension/watch.js` runs in pages while auto-scan is on and asks for a scan when the screen may have changed.
- `extension/options.html` and `options.js` are the settings page. `extension/lib/settings.js` holds the settings they share with the background script.
- `extension/lib/describe.js` decides whether a payload is a link or text.

Run the unit tests with `npm test`. After changing the code, click the reload icon on the extension's card in `chrome://extensions`.
