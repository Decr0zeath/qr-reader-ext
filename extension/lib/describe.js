// Decides how a decoded QR payload is presented: as a link the user can open,
// or as plain text. Only http(s) URLs become links, so payloads such as
// `javascript:` or `data:` URLs are never made clickable.
export function describe(text) {
  const value = text.trim();
  if (/^https?:\/\/\S+$/i.test(value)) {
    try {
      const url = new URL(value);
      // `host` is punycode for internationalized domains, which makes
      // look-alike domains easier to spot.
      return { kind: "link", href: url.href, host: url.host };
    } catch {
      // Not a parseable URL; fall through and show it as text.
    }
  }
  return { kind: "text" };
}
