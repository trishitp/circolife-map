/** Partial-mask device MACs: keep first two octets and the last, hide the rest. */

const MAC_SEP = /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g;
const MAC_BARE = /\b[0-9A-Fa-f]{12}\b/g;
const MAC_ONLY = /^(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/;

function parseMacOctets(raw) {
  const t = String(raw || '').trim();
  const sep = t.match(/^([0-9A-Fa-f]{2})([:\-])(?:[0-9A-Fa-f]{2}\2){4}[0-9A-Fa-f]{2}$/);
  if (sep) return t.split(sep[2]).map((o) => o.toUpperCase());
  if (/^[0-9A-Fa-f]{12}$/.test(t)) {
    const u = t.toUpperCase();
    return [0, 2, 4, 6, 8, 10].map((i) => u.slice(i, i + 2));
  }
  return null;
}

function formatMaskedMac(raw) {
  const octets = parseMacOctets(raw);
  if (!octets) return raw;
  return `${octets[0]}:${octets[1]}:••:••:••:${octets[5]}`;
}

export function looksLikeMac(value) {
  return MAC_ONLY.test(String(value || '').trim());
}

/** `84:1F:E8:A2:95:40` → `84:1F:••:••:••:40` */
export function maskMac(value) {
  if (value == null || value === '') return value;
  const t = String(value).trim();
  if (looksLikeMac(t)) return formatMaskedMac(t);
  return redactMacInText(t);
}

/** Mask MAC-shaped tokens inside names / titles; keep the rest of the string. */
export function redactMacInText(value) {
  if (value == null || value === '') return value;
  return String(value)
    .replace(MAC_SEP, (m) => formatMaskedMac(m))
    .replace(MAC_BARE, (m) => formatMaskedMac(m))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function scrubPublicProperties(props = {}) {
  const out = { ...props };
  if (out.mac != null && out.mac !== '') out.mac = maskMac(out.mac);
  if (out.assetName) out.assetName = redactMacInText(out.assetName);
  if (out.title) out.title = redactMacInText(out.title);
  if (out.assetNumber && looksLikeMac(out.assetNumber)) out.assetNumber = maskMac(out.assetNumber);
  return out;
}
