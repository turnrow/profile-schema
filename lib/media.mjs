// Images: read size and camera metadata from PNG, JPEG and SVG headers, find and remove
// location (GPS) metadata, and choose which of a person's images an output shows.
// No dependencies: the formats are walked chunk by chunk / segment by segment.

import { crc32 } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const XMP_GPS = /exif:GPS[A-Za-z]*/;

/** PNG chunks: [{ type, start (of the length field), dataStart, length }]. */
export function pngChunks(buf) {
  const out = [];
  for (let i = 8; i + 12 <= buf.length; ) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    out.push({ type, start: i, dataStart: i + 8, length });
    i += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

function jpegSegments(buf) {
  const out = [];
  for (let i = 2; i + 4 <= buf.length; ) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) { out.push({ marker, start: i }); break; } // EOI, or start of scan
    const length = buf.readUInt16BE(i + 2);
    out.push({ marker, start: i, dataStart: i + 4, length: length - 2 });
    i += 2 + length;
  }
  return out;
}

// ---------- TIFF (EXIF) ----------

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// Every read stays inside [base, end): the EXIF block (eXIf chunk or APP1 segment). Out of range reads 0.
function tiff(buf, base, end = buf.length) {
  end = Math.min(end, buf.length);
  const le = buf.toString("latin1", base, base + 2) === "II";
  const fits = (o, n) => o >= 0 && base + o + n <= end;
  const u16 = (o) => (!fits(o, 2) ? 0 : le ? buf.readUInt16LE(base + o) : buf.readUInt16BE(base + o));
  const u32 = (o) => (!fits(o, 4) ? 0 : le ? buf.readUInt32LE(base + o) : buf.readUInt32BE(base + o));
  const entries = (ifd) => {
    if (!ifd || !fits(ifd, 2)) return [];
    // A count larger than the block can hold is damage; read only the entries that are really there.
    const n = Math.min(u16(ifd), Math.floor((end - base - ifd - 2) / 12));
    return Array.from({ length: Math.max(0, n) }, (_, k) => {
      const at = ifd + 2 + k * 12;
      const type = u16(at + 2), count = u32(at + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      return { at, tag: u16(at), type, count, size, valueAt: size > 4 ? u32(at + 8) : at + 8 };
    });
  };
  const ascii = (e) => (fits(e.valueAt, e.count) ? buf.toString("latin1", base + e.valueAt, base + e.valueAt + e.count).replace(/\0.*$/s, "").trim() : undefined);
  return { le, u16, u32, entries, ascii, fits, ifd0: u32(4) };
}

function readExif(buf, base, end) {
  const t = tiff(buf, base, end);
  const ifd0 = t.entries(t.ifd0);
  const pick = (list, tag) => list.find((e) => e.tag === tag);
  const gpsPtr = pick(ifd0, 0x8825);
  const gpsEntries = gpsPtr ? t.entries(t.u32(gpsPtr.at + 8)) : [];
  const exifPtr = pick(ifd0, 0x8769);
  const exifIfd = exifPtr ? t.entries(t.u32(exifPtr.at + 8)) : [];
  const meta = {};
  for (const [key, list, tag] of [["make", ifd0, 0x010f], ["model", ifd0, 0x0110], ["software", ifd0, 0x0131], ["dateTimeOriginal", exifIfd, 0x9003]]) {
    const e = pick(list, tag);
    if (e && e.type === 2 && t.ascii(e)) meta[key] = t.ascii(e);
  }
  return { gps: gpsEntries.length > 0, meta, t, gpsPtr };
}

// Empty the GPS IFD in place: zero every value it points to, then its entries, and set its count to 0.
// Offsets elsewhere stay valid, so orientation and camera tags survive.
// Nothing outside the EXIF block is ever written: a value that points outside it is left alone
// (its entry is still removed, so nothing refers to it any more).
function zeroGps(buf, base, end) {
  const { t, gpsPtr } = readExif(buf, base, end);
  if (!gpsPtr) return;
  const ifd = t.u32(gpsPtr.at + 8);
  const entries = t.entries(ifd);
  for (const e of entries) if (e.size > 4 && t.fits(e.valueAt, e.size)) buf.fill(0, base + e.valueAt, base + e.valueAt + e.size);
  if (t.fits(ifd, 2 + entries.length * 12)) buf.fill(0, base + ifd, base + ifd + 2 + entries.length * 12);
}

// XMP: blank exif:GPS* attributes and elements with spaces of the same length (XMP allows padding),
// so no length field changes.
function blankXmpGps(buf, start, end) {
  const text = buf.toString("latin1", start, end);
  const blanked = text
    .replace(/\s?exif:GPS[A-Za-z]*\s*=\s*"[^"]*"/g, (m) => " ".repeat(m.length))
    .replace(/<exif:GPS[A-Za-z]*\b[^>]*>[\s\S]*?<\/exif:GPS[A-Za-z]*>/g, (m) => " ".repeat(m.length))
    .replace(/<exif:GPS[A-Za-z]*\b[^>]*\/>/g, (m) => " ".repeat(m.length));
  buf.write(blanked, start, "latin1");
}

const isXmpText = (buf, c) => buf.toString("latin1", c.dataStart, c.dataStart + 17) === "XML:com.adobe.xmp";
const isExifApp1 = (buf, s) => s.marker === 0xe1 && buf.toString("latin1", s.dataStart, s.dataStart + 6) === "Exif\0\0";
const isXmpApp1 = (buf, s) => s.marker === 0xe1 && buf.toString("latin1", s.dataStart, s.dataStart + 29) === "http://ns.adobe.com/xap/1.0/\0";

/**
 * Size, type, location metadata and a few camera fields of an image.
 * `uninspected` is true for image formats whose metadata is not read (WebP, HEIC, AVIF, TIFF): gps is unknown, not false.
 * @returns {{ mediaType: string, width?: number, height?: number, gps: boolean, gpsWhere: string[], metadata?: object, uninspected?: boolean }}
 */
export function readImageInfo(buf) {
  try {
    return readImageInfoUnsafe(buf);
  } catch (err) {
    // Damaged files are reported, not thrown: callers name the file and carry on.
    const mediaType = buf.subarray(0, 8).equals(PNG_SIG) ? "image/png" : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "application/octet-stream";
    return { mediaType, gps: false, gpsWhere: [], unreadable: err.message };
  }
}

function readImageInfoUnsafe(buf) {
  const gpsWhere = new Set();
  let metadata;
  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    let width, height;
    for (const c of pngChunks(buf)) {
      const data = buf.subarray(c.dataStart, c.dataStart + c.length);
      if (c.dataStart + c.length + 4 > buf.length) throw new Error(`the ${c.type} chunk is cut short`);
      if (c.type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
      if (c.type === "eXIf") { const x = readExif(buf, c.dataStart, c.dataStart + c.length); if (x.gps) gpsWhere.add("exif"); metadata = { ...metadata, ...x.meta }; }
      if ((c.type === "iTXt" || c.type === "tEXt") && isXmpText(buf, c) && XMP_GPS.test(data.toString("latin1"))) gpsWhere.add("xmp");
    }
    if (width === undefined) throw new Error("no complete IHDR chunk");
    return clean({ mediaType: "image/png", width, height, gps: gpsWhere.size > 0, gpsWhere: [...gpsWhere], metadata });
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let width, height;
    for (const s of jpegSegments(buf)) {
      if (s.length == null) continue;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(s.marker)) {
        height = buf.readUInt16BE(s.dataStart + 1); width = buf.readUInt16BE(s.dataStart + 3);
      }
      if (s.dataStart + s.length > buf.length) throw new Error("a JPEG segment is cut short");
      if (isExifApp1(buf, s)) { const x = readExif(buf, s.dataStart + 6, s.dataStart + s.length); if (x.gps) gpsWhere.add("exif"); metadata = { ...metadata, ...x.meta }; }
      if (isXmpApp1(buf, s) && XMP_GPS.test(buf.toString("latin1", s.dataStart, s.dataStart + s.length))) gpsWhere.add("xmp");
    }
    return clean({ mediaType: "image/jpeg", width, height, gps: gpsWhere.size > 0, gpsWhere: [...gpsWhere], metadata });
  }
  const head = buf.toString("utf8", 0, Math.min(buf.length, 4096));
  if (/<svg[\s>]/.test(head)) {
    const tag = head.match(/<svg\b[^>]*>/)?.[0] ?? "";
    const num = (name) => { const m = tag.match(new RegExp(`\\b${name}="([\\d.]+)`)); return m ? Math.round(Number(m[1])) : undefined; };
    const vb = tag.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
    return clean({ mediaType: "image/svg+xml", width: num("width") ?? (vb ? Math.round(Number(vb[1])) : undefined), height: num("height") ?? (vb ? Math.round(Number(vb[2])) : undefined), gps: false, gpsWhere: [] });
  }
  // Formats that can carry location metadata but are not read here. Saying "no GPS" would be a guess,
  // so they are marked uninspected and callers decide (media add refuses; a 2.6.0 bundle is invalid).
  const brand = buf.toString("latin1", 8, 12);
  const uninspected =
    buf.toString("latin1", 0, 4) === "RIFF" && brand === "WEBP" ? "image/webp"
    : buf.toString("latin1", 4, 8) === "ftyp" ? (/^(avif|avis)$/.test(brand) ? "image/avif" : /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand) ? "image/heic" : undefined)
    : ["II*\0", "MM\0*"].includes(buf.toString("latin1", 0, 4)) ? "image/tiff"
    : undefined;
  if (uninspected) return { mediaType: uninspected, gps: false, gpsWhere: [], uninspected: true };
  return { mediaType: "application/octet-stream", gps: false, gpsWhere: [] };
}

/** A copy of the image with location metadata removed in place (EXIF GPS IFD emptied, XMP GPS blanked). */
export function stripGps(input, mediaType = readImageInfo(input).mediaType) {
  const buf = Buffer.from(input);
  if (mediaType === "image/png") {
    for (const c of pngChunks(buf)) {
      const touched = c.type === "eXIf" || ((c.type === "iTXt" || c.type === "tEXt") && isXmpText(buf, c));
      if (c.dataStart + c.length + 4 > buf.length) break;
      if (c.type === "eXIf") zeroGps(buf, c.dataStart, c.dataStart + c.length);
      if (touched && c.type !== "eXIf") blankXmpGps(buf, c.dataStart, c.dataStart + c.length);
      if (touched) buf.writeUInt32BE(crc32(buf.subarray(c.start + 4, c.dataStart + c.length)), c.dataStart + c.length);
    }
  } else if (mediaType === "image/jpeg") {
    for (const s of jpegSegments(buf)) {
      if (s.length == null) continue;
      if (s.dataStart + s.length > buf.length) break;
      if (isExifApp1(buf, s)) zeroGps(buf, s.dataStart + 6, s.dataStart + s.length);
      if (isXmpApp1(buf, s)) blankXmpGps(buf, s.dataStart, s.dataStart + s.length);
    }
  }
  return buf;
}

function clean(o) {
  if (o.metadata && !Object.keys(o.metadata).length) delete o.metadata;
  for (const k of ["width", "height", "metadata"]) if (o[k] === undefined) delete o[k];
  return o;
}

// ---------- choosing an image ----------

const IMAGE_KINDS = new Set(["headshot", "portrait", "banner", "logo", "photo"]);
export const isImage = (m) => !!m && ((m.mediaType ?? "").startsWith("image/") || IMAGE_KINDS.has(m.kind) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(m.url ?? ""));

const lower = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);
// Dates are compared at the coarser of the two precisions, so a photo from "2019-03" is in force for a job dated "2019".
const inForce = (row, on) => {
  const from = lower(row.from), to = lower(row.to);
  return (!from || from.slice(0, on.length) <= on.slice(0, from.length)) && (!to || on.slice(0, to.length) <= to.slice(0, on.length));
};

/**
 * The image an output shows, as a media entry (with id), or a synthetic one from person.image.
 * ref.position → its own media; else ref.entry's media; else the person's image in force at the
 * position's (or entry's) start; without a ref, the person's image in force on `on`.
 * @param {object} profile
 * @param {{ entry?: object, position?: object }} [ref]
 * @param {string} [on] yyyy-mm-dd
 * @param {string[]} [purposes] person image purposes accepted, in order
 * @param {(m: object) => boolean} [usable] media entries an output may show (visibility, status…)
 */
export function imageFor(profile, ref = {}, on = new Date().toISOString().slice(0, 10), purposes = ["primary", "headshot"], usable = () => true) {
  const media = new Map((profile.media ?? []).filter(usable).map((m) => [m.id, m]));
  const firstImage = (ids) => (ids ?? []).map((id) => media.get(id)).find(isImage);
  const own = firstImage(ref.position?.media) ?? firstImage(ref.entry?.media);
  if (own) return own;
  const when = lower(ref.position?.startDate) ?? lower(ref.entry?.startDate) ?? on;
  for (const purpose of purposes) {
    const rows = (profile.person?.images ?? []).filter((r) => r.purpose === purpose && media.has(r.media) && inForce(r, when));
    // When two overlap, the one that started later is the newer portrait.
    rows.sort((a, b) => String(lower(b.from) ?? "").localeCompare(String(lower(a.from) ?? "")));
    if (rows.length) return media.get(rows[0].media);
  }
  const img = profile.person?.image;
  return img ? { id: "person.image", url: img.url, alt: img.alt, width: img.width, height: img.height, credit: img.credit } : undefined;
}

/** The URL to show for an image: a rendition of the wanted purpose when there is one, else the file. */
export function renditionUrl(m, purpose) {
  return (purpose && (m?.renditions ?? []).find((r) => r.purpose === purpose)?.url) || m?.url;
}

/** Overlapping dated images of the same purpose, as [aId, bId, purpose] triples. */
export function overlappingImages(person) {
  const rows = person?.images ?? [];
  const out = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (a.purpose !== b.purpose) continue;
    const aEnd = lower(a.to) ?? "9999", bEnd = lower(b.to) ?? "9999", aStart = lower(a.from) ?? "0000", bStart = lower(b.from) ?? "0000";
    if (aStart <= bEnd.padEnd(aStart.length, "9") && bStart <= aEnd.padEnd(bStart.length, "9")) out.push([a.media, b.media, a.purpose]);
  }
  return out;
}
