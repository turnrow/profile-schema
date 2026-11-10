// GEDCOM 7.0 (FamilySearch): write a profile as one individual with the facts of their working
// life, the sources those facts cite and their images; and package it with its media as GEDZip.
// What goes in (which entries, names, dates, wording) is decided by mappings/gedcom7.json, like
// every other output. This module turns that view into GEDCOM lines and, for GEDZip, into a zip.

import { crc32 } from "node:zlib";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** The marker convert() resolves bundle: links against when the media travel inside a GEDZip. */
export const GEDZIP_MEDIA = "turnrow-bundle://";
/** Our one extension tag, declared in HEAD.SCHMA so that a reader can look it up. */
export const EXTENSIONS = Object.freeze({
  _CONF: "https://github.com/turnrow/profile-schema/blob/main/README.md#gedcom-7",
});
// Evidence quality → QUAY (0 unreliable … 3 direct and primary).
const QUAY = { primary: 3, secondary: 2, published: 2, selfReported: 1, hearsay: 0 };
const NAME_TYPE = { birth: ["BIRTH"], professional: ["PROFESSIONAL"], alsoKnownAs: ["AKA"], nickname: ["AKA"],
  legal: ["OTHER", "legal name"], transliteration: ["OTHER", "transliteration"], native: ["OTHER", "name in its own script"] };

/** A partial ISO date ("1996", "1996-03", "1996-03-05") as a GEDCOM date: "1996", "MAR 1996", "5 MAR 1996". */
export function gedcomDate(iso) {
  if (typeof iso !== "string") return undefined;
  const m = iso.slice(0, 10).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m || (m[2] && !MONTHS[+m[2] - 1])) return undefined;
  const year = String(+m[1]);
  return [m[3] && String(+m[3]), m[2] && MONTHS[+m[2] - 1], year].filter(Boolean).join(" ");
}

/** A profile date, exact or uncertain, as a GEDCOM date value: "ABT 1996", "BEF 1998", "BET 1990 AND 1991". */
export function gedcomDateValue(d) {
  if (d == null) return undefined;
  if (typeof d === "string") return gedcomDate(d);
  if (d.between) { const [a, b] = d.between.map(gedcomDate); return a && b ? `BET ${a} AND ${b}` : undefined; }
  const v = gedcomDate(d.value);
  if (!v) return undefined;
  return { about: `ABT ${v}`, estimated: `EST ${v}`, calculated: `CAL ${v}`, before: `BEF ${v}`, after: `AFT ${v}` }[d.qualifier] ?? v;
}

const lower = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);
const upper = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[1]);
const isExact = (d) => d == null || typeof d === "string" || d.qualifier === "calculated";

/**
 * When something happened, as a GEDCOM date. A span is a period ("FROM MAR 2019 TO OCT 2026", or
 * "FROM MAR 2024" while it lasts); a single date with no end is that date ("MAR 2024", "ABT 2008").
 * A period can only hold plain dates, so an uncertain end ("about 1996") is written at its nearest
 * plain date and `uncertain` says so; the caller adds the wording as the DATE's PHRASE.
 * @returns {{ value?: string, uncertain: boolean }}
 */
export function gedcomPeriod(start, end, current) {
  // One date and nothing after it is a moment, not "from then on": a founding, a move, an award.
  if (start != null && end == null && !current) return { value: gedcomDateValue(start), uncertain: false };
  const from = gedcomDate(lower(start)), to = current ? undefined : gedcomDate(upper(end));
  const value = from && to ? `FROM ${from} TO ${to}` : from ? `FROM ${from}` : to ? `TO ${to}` : undefined;
  return { value, uncertain: !isExact(start) || (!current && !isExact(end)) };
}

// ---------- lines ----------

// One structure and its substructures: [level, tag, value?, xref?]. Text that spans lines continues
// with CONT; a value that begins with "@" is written "@@" so it is not read as a pointer.
function line(out, level, tag, value, { xref, pointer = false } = {}) {
  const head = `${level} ${xref ? `${xref} ` : ""}${tag}`;
  if (value == null || value === "") { out.push(head); return; }
  const clean = pointer ? [String(value)] : String(value).normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").split("\n");
  const esc = (s) => (!pointer && s.startsWith("@") ? `@${s}` : s);
  out.push(clean[0] === "" ? head : `${head} ${esc(clean[0])}`);
  for (const more of clean.slice(1)) out.push(more === "" ? `${level + 1} CONT` : `${level + 1} CONT ${esc(more)}`);
}
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Write the GEDCOM 7 text for a view made by mappings/gedcom7.json.
 * @param {object} view
 * @returns {string} GEDCOM 7.0, UTF-8, lines ending in "\n"
 */
export function renderGedcom7(view) {
  const out = [];
  const facts = view.facts ?? [];
  // Only sources that a written fact cites are written, numbered in the order they are first cited.
  const sourceIds = [];
  for (const f of facts) for (const c of f.citations ?? []) if (view.sources?.some((s) => s.id === c.source) && !sourceIds.includes(c.source)) sourceIds.push(c.source);
  const sourceRef = new Map(sourceIds.map((id, i) => [id, `@S${i + 1}@`]));
  const media = (view.media ?? []).filter((m) => m.file);
  const mediaRef = new Map(media.map((m, i) => [m.id, `@O${i + 1}@`]));
  const usesConfidence = facts.some((f) => f.confidence);

  line(out, 0, "HEAD");
  line(out, 1, "GEDC");
  line(out, 2, "VERS", "7.0");
  if (usesConfidence) {
    line(out, 1, "SCHMA");
    for (const [tag, uri] of Object.entries(EXTENSIONS)) line(out, 2, "TAG", `${tag} ${uri}`);
  }
  line(out, 1, "SOUR", view.product?.id ?? "https://github.com/turnrow/profile-schema");
  if (view.product?.version) line(out, 2, "VERS", view.product.version);
  if (view.product?.name) line(out, 2, "NAME", view.product.name);
  if (gedcomDate(view.date)?.split(" ").length === 3) line(out, 1, "DATE", gedcomDate(view.date));
  if (view.lang) line(out, 1, "LANG", view.lang);

  line(out, 0, "INDI", undefined, { xref: "@I1@" });
  const names = view.names?.length ? view.names : [{ full: view.name }];
  for (const n of names) {
    // GEDCOM marks the family name with slashes; a name whose parts aren't known is written whole.
    const full = oneLine(n.full).replace(/\//g, " ");
    const family = oneLine(n.family).replace(/\//g, " ");
    const payload = family && full.includes(family) ? full.replace(family, `/${family}/`) : full;
    if (!payload) continue;
    line(out, 1, "NAME", payload);
    const [type, phrase] = NAME_TYPE[n.type] ?? [];
    if (type) { line(out, 2, "TYPE", type); if (phrase) line(out, 3, "PHRASE", phrase); }
    if (n.prefix) line(out, 2, "NPFX", oneLine(n.prefix));
    if (n.given) line(out, 2, "GIVN", oneLine(n.given));
    if (n.type === "nickname") line(out, 2, "NICK", full);
    if (family) line(out, 2, "SURN", family);
    if (n.suffix) line(out, 2, "NSFX", oneLine(n.suffix));
    // GEDCOM has no dates on names, so when a name was in use is said in a note.
    if (n.usedText) line(out, 2, "NOTE", n.usedText);
  }

  for (const f of facts) {
    line(out, 1, f.tag, oneLine(f.value));
    if (f.type) line(out, 2, "TYPE", oneLine(f.type));
    if (f.date || f.datePhrase) {
      line(out, 2, "DATE", f.date);
      if (f.datePhrase) line(out, 3, "PHRASE", oneLine(f.datePhrase));
    }
    if (f.place) line(out, 2, "PLAC", oneLine(f.place));
    if (f.agency) line(out, 2, "AGNC", oneLine(f.agency));
    if (f.note) line(out, 2, "NOTE", f.note);
    for (const c of f.citations ?? []) {
      const ref = sourceRef.get(c.source);
      if (!ref) continue;
      line(out, 2, "SOUR", ref, { pointer: true });
      if (c.locator) line(out, 3, "PAGE", oneLine(c.locator));
      if (c.quote) { line(out, 3, "DATA"); line(out, 4, "TEXT", c.quote); }
      const quality = c.quality ?? view.sources.find((s) => s.id === c.source)?.defaultQuality ?? "selfReported";
      line(out, 3, "QUAY", String(QUAY[quality] ?? 1));
    }
    if (f.confidence) line(out, 2, "_CONF", f.confidence);
  }
  for (const m of media) line(out, 1, "OBJE", mediaRef.get(m.id), { pointer: true });

  for (const m of media) {
    line(out, 0, "OBJE", undefined, { xref: mediaRef.get(m.id) });
    // Inside a GEDZip the file is named by its path in the archive; otherwise by its web address.
    line(out, 1, "FILE", m.file.startsWith(GEDZIP_MEDIA) ? m.file.slice(GEDZIP_MEDIA.length) : m.file);
    line(out, 2, "FORM", m.form ?? "application/octet-stream");
    if ((m.form ?? "").startsWith("image/")) line(out, 3, "MEDI", "PHOTO");
    if (m.title) line(out, 2, "TITL", oneLine(m.title));
    if (m.alt) line(out, 1, "NOTE", `Description: ${oneLine(m.alt)}`);
  }
  for (const id of sourceIds) {
    const s = view.sources.find((x) => x.id === id);
    line(out, 0, "SOUR", undefined, { xref: sourceRef.get(id) });
    line(out, 1, "TITL", oneLine(s.title) || id);
    if (s.author) line(out, 1, "AUTH", oneLine(s.author));
    const published = [s.date, s.url].filter(Boolean).join("; ");
    if (published) line(out, 1, "PUBL", published);
  }
  line(out, 0, "TRLR");
  return out.join("\n") + "\n";
}

// ---------- GEDCOM 5.5.1 ----------

// Value sizes from the 5.5.1 specification's primitive elements, for values that can't be continued.
const MAX551 = { NAME: 120, OCCU: 90, EDUC: 248, TYPE: 90, PLAC: 120, AGNC: 120, PAGE: 248, TITL: 248, PIECE: 120, NICK: 30, AFFIX: 30, SUBM: 60, PRODUCT: 90 };
// 5.5.1 names languages in English, from a fixed list.
const LANG551 = { af: "Afrikaans", sq: "Albanian", ar: "Arabic", bg: "Bulgarian", ca: "Catalan", cs: "Czech", da: "Danish", nl: "Dutch", en: "English",
  et: "Estonian", fi: "Finnish", fr: "French", de: "German", el: "Greek", he: "Hebrew", hi: "Hindi", hu: "Hungarian", is: "Icelandic", id: "Indonesian",
  it: "Italian", ja: "Japanese", ko: "Korean", lv: "Latvian", lt: "Lithuanian", no: "Norwegian", fa: "Persian", pl: "Polish", pt: "Portuguese",
  ro: "Romanian", ru: "Russian", sk: "Slovak", sl: "Slovene", es: "Spanish", sv: "Swedish", th: "Thai", tr: "Turkish", uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese", yi: "Yiddish" };
const NAME_TYPE551 = { birth: "birth", alsoKnownAs: "aka", nickname: "aka", professional: "professional", legal: "legal name", transliteration: "transliteration", native: "name in its own script" };
const FORM551 = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/tiff": "tif", "image/bmp": "bmp", "image/svg+xml": "svg", "image/webp": "webp", "application/pdf": "pdf", "audio/wav": "wav" };

// One 5.5.1 structure. Every "@" is doubled; a line break continues with CONT; and a line longer
// than 255 bytes continues with CONC, broken where neither side begins or ends with a space (a
// reader may trim them) and never inside a doubled "@" or a combined character.
function line551(out, level, tag, value, { xref, pointer = false } = {}) {
  const head = `${level} ${xref ? `${xref} ` : ""}${tag}`;
  if (value == null || value === "") { out.push(head); return; }
  if (pointer) { out.push(`${head} ${value}`); return; }
  const paragraphs = String(value).normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").split("\n");
  paragraphs.forEach((para, pi) => {
    let prefix = pi === 0 ? head : `${level + 1} CONT`;
    let rest = [...para.replace(/@/g, "@@")];
    do {
      const room = 254 - Buffer.byteLength(prefix, "utf8") - 1;   // the line, a space, and its terminator
      let n = 0, bytes = 0;
      while (n < rest.length && bytes + Buffer.byteLength(rest[n], "utf8") <= room) bytes += Buffer.byteLength(rest[n++], "utf8");
      if (n < rest.length) {
        const bad = (k) => k > 1 && (rest[k - 1] === " " || rest[k] === " " || /\p{M}/u.test(rest[k]) || (rest[k] === "@" && rest.slice(0, k).join("").match(/@*$/)[0].length % 2 === 1));
        let k = n;
        while (bad(k) && k > n - 40) k--;
        if (!bad(k)) n = k;
      }
      const piece = rest.slice(0, n).join("");
      out.push(piece === "" ? prefix : `${prefix} ${piece}`);
      rest = rest.slice(n);
      prefix = `${level + 1} CONC`;
    } while (rest.length);
  });
}
// A value that can't be continued is cut at its limit; the whole of it is then kept in a note.
const fit551 = (value, max) => { const chars = [...oneLine(value)]; return chars.length > max ? { text: chars.slice(0, max - 1).join("") + "…", cut: true } : { text: chars.join(""), cut: false }; };

/**
 * Write the same view as GEDCOM 5.5.1, for the many programs that don't read 7.0 yet.
 * What 5.5.1 has no place for is kept as a NOTE, so nothing is dropped without a trace: the
 * wording of an uncertain date, the confidence, and the title of a residence or event.
 * @param {object} view  made by mappings/gedcom551.json (the gedcom7 view)
 * @returns {string} GEDCOM 5.5.1, UTF-8, lines ending in "\n"
 */
export function renderGedcom551(view) {
  const out = [];
  const facts = view.facts ?? [];
  const sourceIds = [];
  for (const f of facts) for (const c of f.citations ?? []) if (view.sources?.some((s) => s.id === c.source) && !sourceIds.includes(c.source)) sourceIds.push(c.source);
  const sourceRef = new Map(sourceIds.map((id, i) => [id, `@S${i + 1}@`]));
  const media = (view.media ?? []).filter((m) => m.file);
  const mediaRef = new Map(media.map((m, i) => [m.id, `@O${i + 1}@`]));
  // A value with a size limit: written within it, with the whole text noted when it had to be cut.
  const limited = (level, tag, value, max, notes, label = tag) => {
    const { text, cut } = fit551(value, max);
    if (!text) return;
    line551(out, level, tag, text);
    if (cut) notes.push(`${label} in full: ${oneLine(value)}`);
  };

  line551(out, 0, "HEAD");
  line551(out, 1, "SOUR", "TURNROW_PROFILE");
  if (view.product?.version) line551(out, 2, "VERS", String(view.product.version).slice(0, 15));
  if (view.product?.name) line551(out, 2, "NAME", fit551(view.product.name, MAX551.PRODUCT).text);
  if (gedcomDate(view.date)?.split(" ").length === 3) line551(out, 1, "DATE", gedcomDate(view.date));
  line551(out, 1, "SUBM", "@U1@", { pointer: true });
  line551(out, 1, "GEDC");
  line551(out, 2, "VERS", "5.5.1");
  line551(out, 2, "FORM", "LINEAGE-LINKED");
  line551(out, 1, "CHAR", "UTF-8");
  const lang = LANG551[String(view.lang ?? "").split("-")[0].toLowerCase()];
  if (lang) line551(out, 1, "LANG", lang);

  // 5.5.1 requires a submitter: here, the person the record is about.
  line551(out, 0, "SUBM", undefined, { xref: "@U1@" });
  line551(out, 1, "NAME", fit551(view.name ?? view.names?.[0]?.full ?? "Unknown", MAX551.SUBM).text);

  line551(out, 0, "INDI", undefined, { xref: "@I1@" });
  const names = view.names?.length ? view.names : [{ full: view.name }];
  for (const n of names) {
    const full = oneLine(n.full).replace(/\//g, " ");
    const family = oneLine(n.family).replace(/\//g, " ");
    const payload = family && full.includes(family) ? full.replace(family, `/${family}/`) : full;
    if (!payload) continue;
    const notes = [];
    limited(1, "NAME", payload, MAX551.NAME, notes, "Name");
    if (NAME_TYPE551[n.type]) line551(out, 2, "TYPE", NAME_TYPE551[n.type]);
    if (n.prefix) line551(out, 2, "NPFX", fit551(n.prefix, MAX551.AFFIX).text);
    if (n.given) line551(out, 2, "GIVN", fit551(n.given, MAX551.PIECE).text);
    if (n.type === "nickname") line551(out, 2, "NICK", fit551(full, MAX551.NICK).text);
    if (family) line551(out, 2, "SURN", fit551(family, MAX551.PIECE).text);
    if (n.suffix) line551(out, 2, "NSFX", fit551(n.suffix, MAX551.AFFIX).text);
    for (const note of [n.usedText, ...notes]) if (note) line551(out, 2, "NOTE", note);
  }

  for (const f of facts) {
    const notes = [];
    // In 5.5.1 a residence and a generic event take no value of their own: what happened goes in a note.
    if (f.tag === "RESI" || f.tag === "EVEN") { line551(out, 1, f.tag); if (f.value) notes.push(oneLine(f.value)); }
    else limited(1, f.tag, f.value, MAX551[f.tag] ?? 90, notes, f.tag === "OCCU" ? "Occupation" : "Education");
    if (f.type) limited(2, "TYPE", f.type, MAX551.TYPE, notes, "Type");
    if (f.date) line551(out, 2, "DATE", f.date);
    if (f.place) limited(2, "PLAC", f.place, MAX551.PLAC, notes, "Place");
    if (f.agency) limited(2, "AGNC", f.agency, MAX551.AGNC, notes, "Organization");
    // 7.0's DATE PHRASE and our confidence tag have no 5.5.1 structure.
    if (f.datePhrase) notes.push(`Date as recorded: ${oneLine(f.datePhrase)}`);
    if (f.note) notes.push(f.note);
    if (f.confidence) notes.push(`Confidence: ${f.confidence}`);
    for (const note of notes) line551(out, 2, "NOTE", note);
    for (const c of f.citations ?? []) {
      const ref = sourceRef.get(c.source);
      if (!ref) continue;
      line551(out, 2, "SOUR", ref, { pointer: true });
      if (c.locator) line551(out, 3, "PAGE", fit551(c.locator, MAX551.PAGE).text);
      if (c.quote) { line551(out, 3, "DATA"); line551(out, 4, "TEXT", c.quote); }
      const quality = c.quality ?? view.sources.find((s) => s.id === c.source)?.defaultQuality ?? "selfReported";
      line551(out, 3, "QUAY", String(QUAY[quality] ?? 1));
    }
  }
  for (const m of media) line551(out, 1, "OBJE", mediaRef.get(m.id), { pointer: true });

  for (const m of media) {
    const file = m.file.startsWith(GEDZIP_MEDIA) ? m.file.slice(GEDZIP_MEDIA.length) : m.file;
    line551(out, 0, "OBJE", undefined, { xref: mediaRef.get(m.id) });
    line551(out, 1, "FILE", file);
    line551(out, 2, "FORM", FORM551[m.form] ?? (file.match(/\.([A-Za-z0-9]{2,4})(?:[?#].*)?$/)?.[1].toLowerCase() ?? "ole"));
    if ((m.form ?? "").startsWith("image/")) line551(out, 3, "TYPE", "photo");
    if (m.title) line551(out, 2, "TITL", fit551(m.title, MAX551.TITL).text);
    if (m.alt) line551(out, 1, "NOTE", `Description: ${oneLine(m.alt)}`);
  }
  for (const id of sourceIds) {
    const s = view.sources.find((x) => x.id === id);
    line551(out, 0, "SOUR", undefined, { xref: sourceRef.get(id) });
    if (s.author) line551(out, 1, "AUTH", oneLine(s.author));
    line551(out, 1, "TITL", oneLine(s.title) || id);
    const published = [s.date, s.url].filter(Boolean).join("; ");
    if (published) line551(out, 1, "PUBL", published);
  }
  line551(out, 0, "TRLR");
  return out.join("\n") + "\n";
}

/** The bundle-relative paths of the media a GEDCOM 7 view refers to inside a GEDZip. */
export function gedzipMedia(view) {
  return (view.media ?? []).map((m) => m.file).filter((f) => f?.startsWith(GEDZIP_MEDIA)).map((f) => f.slice(GEDZIP_MEDIA.length));
}

/**
 * Read the media a GEDZip needs from a bundle folder. A path that leaves the folder, directly or
 * through a symbolic link, or that isn't there, is refused: the archive holds only the bundle's own files.
 * @returns {{ name: string, data: Buffer }[]}
 */
export function readBundleMedia(bundleDir, paths) {
  const root = resolve(bundleDir);
  return [...new Set(paths)].map((rel) => {
    const file = resolve(root, decodeURI(rel));
    if (!file.startsWith(root + sep) || !existsSync(file) || !realpathSync(file).startsWith(realpathSync(root) + sep)) {
      throw new Error(`${rel} is not a file inside the bundle`);
    }
    return { name: rel, data: readFileSync(file) };
  });
}

// ---------- GEDZip ----------

/**
 * A zip archive with its files stored uncompressed: all GEDZip asks for, and no dependency.
 * @param {{ name: string, data: Buffer | string }[]} files  names use "/" and are relative
 * @returns {Buffer}
 */
export function storeZip(files) {
  const local = [], central = [];
  let offset = 0;
  const seen = new Set();
  for (const f of files) {
    if (!f.name || f.name.startsWith("/") || f.name.split("/").includes("..") || f.name.includes("\\")) throw new Error(`not a relative archive path: ${f.name}`);
    if (seen.has(f.name)) throw new Error(`the archive already holds ${f.name}`);
    seen.add(f.name);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const name = Buffer.from(f.name, "utf8");
    if (data.length > 0xfffffffe || offset > 0xfffffffe) throw new Error("too large for a plain zip archive (4 GB)");
    const crc = crc32(data);
    // Fixed date (1 Jan 2000): the same input always makes the same archive.
    const common = (b, at) => { b.writeUInt16LE(0x0800, at); b.writeUInt16LE(0, at + 2); b.writeUInt16LE(0, at + 4); b.writeUInt16LE(0x2821, at + 6); b.writeUInt32LE(crc, at + 8); b.writeUInt32LE(data.length, at + 12); b.writeUInt32LE(data.length, at + 16); b.writeUInt16LE(name.length, at + 20); };
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); common(lh, 6);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); common(ch, 8); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  if (files.length > 0xfffe) throw new Error("too many files for a plain zip archive");
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

/**
 * A GEDZip: the GEDCOM text as gedcom.ged, and each local file it names at the path it names.
 * @param {string} gedcom
 * @param {{ name: string, data: Buffer }[]} media
 */
export function gedzip(gedcom, media = []) {
  return storeZip([{ name: "gedcom.ged", data: gedcom }, ...media]);
}
