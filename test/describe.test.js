import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "../extension/lib/describe.js";

test("http and https URLs are links", () => {
  assert.deepEqual(describe("https://example.com/menu?table=4"), {
    kind: "link",
    href: "https://example.com/menu?table=4",
    host: "example.com",
  });
  assert.equal(describe("HTTP://Example.com").kind, "link");
});

test("surrounding whitespace is ignored", () => {
  assert.equal(describe("  https://example.com/\n").href, "https://example.com/");
});

test("internationalized domains are shown as punycode", () => {
  assert.equal(describe("https://аpple.com/").host, "xn--pple-43d.com");
});

test("other schemes are treated as text", () => {
  for (const text of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@example.com",
    "WIFI:S:Home;T:WPA;P:secret;;",
    "ftp://example.com/file",
  ]) {
    assert.equal(describe(text).kind, "text", text);
  }
});

test("plain text, bare domains and text containing a URL are text", () => {
  for (const text of ["Hello world", "example.com", "visit https://example.com today", "https://"]) {
    assert.equal(describe(text).kind, "text", text);
  }
});
