// Copies the zxing-wasm reader build into the extension so it ships with
// the package instead of being fetched from a CDN at runtime.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "zxing-wasm");
const dest = join(root, "extension", "vendor", "zxing-wasm");

const files = [
  ["dist/es/reader/index.js", "reader/index.js"],
  ["dist/es/share.js", "share.js"],
  ["dist/reader/zxing_reader.wasm", "zxing_reader.wasm"],
  ["LICENSE", "LICENSE"],
];

rmSync(dest, { recursive: true, force: true });
for (const [from, to] of files) {
  mkdirSync(dirname(join(dest, to)), { recursive: true });
  cpSync(join(src, from), join(dest, to));
}
console.log(`Copied zxing-wasm into ${dest}`);
