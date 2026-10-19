import { test } from "node:test";
import assert from "node:assert/strict";
import { siteOf } from "../extension/lib/settings.js";

test("web pages are keyed by hostname", () => {
  assert.equal(siteOf("https://www.example.com/menu?table=4"), "www.example.com");
  assert.equal(siteOf("http://localhost:8080/"), "localhost");
});

test("pages auto-scan never runs on have no site", () => {
  for (const url of ["chrome://extensions", "file:///C:/qr.png", "about:blank", "not a url", undefined]) {
    assert.equal(siteOf(url), null, String(url));
  }
});
