// Badges: checks for badges[] entries (Open Badges 3.0 terms). Import lives here too (Task 7).

import { checkCode } from "./codes.mjs";

const FRAMEWORK = (name, code) => {
  const n = String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (n === "soc") return "soc";
  if (n === "onet" || n === "onetsoc") return /^\d{2}-\d{4}\.\d{2}$/.test(code) ? "onetSoc" : "onet";
  return undefined;
};

/** Validation of badges[]: references, alignment codes, verification and expiry. */
export function checkBadges(profile, { errors, warnings, v26, ids, credentialIds, today }) {
  for (const b of profile.badges ?? []) {
    const at = `badges/${b.id}`;
    if (b.credentialRef && !credentialIds.has(b.credentialRef)) errors.push(`${at}: credentialRef "${b.credentialRef}" is not a credentials entry`);
    if (b.awardedFor && !ids.has(b.awardedFor)) errors.push(`${at}: awardedFor "${b.awardedFor}" is not an entry`);
    for (const a of b.achievement?.alignment ?? []) {
      const system = FRAMEWORK(a.targetFramework, a.targetCode);
      if (system && a.targetCode) {
        const r = checkCode(system, { code: a.targetCode }, `${at} › alignment ${a.targetFramework} ${a.targetCode}`);
        errors.push(...r.errors);
      }
    }
    const v = b.verification;
    if (v?.status === "verified" && (!v.method || !v.checkedAt)) (v26 ? errors : warnings).push(`${at}: verification.status is verified but method and checkedAt are not recorded`);
    if (b.validUntil && (b.status ?? "draft") === "approved" && String(b.validUntil).slice(0, 10) < today) warnings.push(`${at}: expired ${String(b.validUntil).slice(0, 10)}; mark it expired or retire it`);
  }
}

// ---------- import ----------

import { pngChunks } from "./media.mjs";

const isHttp = (s) => typeof s === "string" && /^https?:\/\//.test(s);
const first = (v) => (Array.isArray(v) ? v[0] : v);
const types = (o) => [].concat(o?.type ?? []);
const textValue = (v) => (typeof v === "string" ? v : v?.["@value"] ?? undefined);

function slug(s) { return String(s ?? "badge").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "badge"; }

function jwtPayload(text) {
  const parts = text.trim().split(".");
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return undefined;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return undefined; }
}
const isOb3 = (o) => types(o).some((t) => ["OpenBadgeCredential", "AchievementCredential"].includes(t));
const isOb2 = (o) => types(o).includes("Assertion") || (o?.badge && o?.recipient);

function fromOb3(vc, format) {
  const a = first(vc.credentialSubject)?.achievement ?? {};
  const issuer = typeof vc.issuer === "string" ? { id: vc.issuer } : vc.issuer ?? {};
  const image = typeof a.image === "string" ? a.image : a.image?.id;
  return clean({
    achievement: clean({
      id: a.id, achievementType: a.achievementType, name: textValue(a.name) ?? textValue(vc.name) ?? "Badge", description: textValue(a.description),
      criteria: a.criteria ? clean({ id: a.criteria.id, narrative: textValue(a.criteria.narrative) }) : undefined,
      image: isHttp(image) ? clean({ url: image, caption: a.image?.caption }) : undefined,
      alignment: (a.alignment ?? []).filter((x) => x.targetName && x.targetUrl).map((x) => clean({ targetName: x.targetName, targetUrl: x.targetUrl, targetDescription: x.targetDescription, targetFramework: x.targetFramework, targetCode: x.targetCode, targetType: x.targetType })),
      tag: a.tag,
    }),
    issuer: issuer.name ? { name: textValue(issuer.name) } : undefined,
    issuerId: issuer.id,
    validFrom: vc.validFrom ?? vc.issuanceDate, validUntil: vc.validUntil ?? vc.expirationDate,
    credential: clean({ format, url: isHttp(vc.id) ? vc.id : undefined }),
  });
}

function fromOb2(as, format) {
  const bc = typeof as.badge === "object" ? as.badge : {};
  const issuer = typeof bc.issuer === "object" ? bc.issuer : {};
  const criteria = typeof bc.criteria === "string" ? { id: bc.criteria } : bc.criteria;
  const image = typeof bc.image === "string" ? bc.image : bc.image?.id;
  return clean({
    achievement: clean({
      id: typeof as.badge === "string" ? as.badge : bc.id, name: bc.name ?? "Badge", description: bc.description,
      criteria: criteria ? clean({ id: criteria.id, narrative: criteria.narrative }) : undefined,
      image: isHttp(image) ? { url: image } : undefined,
      alignment: (bc.alignment ?? []).filter((x) => x.targetName && x.targetUrl).map((x) => clean({ targetName: x.targetName, targetUrl: x.targetUrl, targetDescription: x.targetDescription, targetFramework: x.targetFramework, targetCode: x.targetCode })),
      tag: bc.tags,
    }),
    issuer: issuer.name ? { name: issuer.name } : undefined,
    issuerId: typeof bc.issuer === "string" ? bc.issuer : issuer.id,
    validFrom: as.issuedOn, validUntil: as.expires,
    credential: clean({ format, url: format === "ob2-hosted" && isHttp(as.id) ? as.id : undefined }),
  });
}

// Read whatever was baked into an image: { text } for PNG iTXt, or the SVG element's CDATA/verify URL.
function baked(buf) {
  if (buf.subarray(0, 4).toString("latin1") === "\x89PNG") {
    for (const c of pngChunks(buf)) {
      if (c.type !== "iTXt") continue;
      const data = buf.subarray(c.dataStart, c.dataStart + c.length);
      const nul = data.indexOf(0);
      const keyword = data.toString("latin1", 0, nul);
      if (keyword !== "openbadges" && keyword !== "openbadgecredential") continue;
      // keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
      let i = nul + 3;
      i = data.indexOf(0, i) + 1;
      i = data.indexOf(0, i) + 1;
      return { text: data.toString("utf8", i), ext: ".png" };
    }
    return undefined;
  }
  const s = buf.toString("utf8");
  const m = s.match(/<openbadges:(assertion|credential)\b([^>]*)>([\s\S]*?)<\/openbadges:\1>/) ?? s.match(/<openbadges:(assertion|credential)\b([^>]*)\/>/);
  if (!m) return undefined;
  const cdata = (m[3] ?? "").match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1];
  const verify = m[2].match(/verify="([^"]+)"/)?.[1];
  return { text: cdata?.trim() || verify, ext: ".svg" };
}

/**
 * Turn an Open Badge file into a badges[] entry. The original bytes are returned untouched.
 * Reads OB 3.0 JSON-LD and VC-JWT, OB 2.0 hosted JSON and signed JWS, and badges baked into PNG or SVG.
 * Never fetches: a baked URL is recorded as a hosted credential to verify later.
 * @returns {{ entry: object, original: Buffer, ext: string }}
 */
export function parseBadge(buf, { name, id } = {}) {
  const original = Buffer.from(buf);
  let entry, ext;
  const fromText = (text, bakedFormat) => {
    const t = text.trim();
    if (isHttp(t)) return { achievement: { name: name ?? "Badge" }, credential: { format: "ob2-hosted", url: t } };
    const jwt = jwtPayload(t);
    if (jwt?.vc && isOb3(jwt.vc)) return fromOb3(jwt.vc, "ob3-jwt");
    if (jwt && isOb2(jwt)) return fromOb2(jwt, "ob2-signed");
    let json;
    try { json = JSON.parse(t); } catch { return undefined; }
    if (isOb3(json)) return fromOb3(json, "ob3-jsonld");
    if (isOb2(json)) return fromOb2(json, bakedFormat ?? (json.verification?.type === "signed" ? "ob2-signed" : "ob2-hosted"));
    return undefined;
  };
  const b = baked(buf);
  if (b?.text) {
    entry = fromText(b.text, "ob2-baked");
    ext = b.ext;
  } else {
    const text = buf.toString("utf8");
    entry = fromText(text);
    ext = jwtPayload(text) ? ".jwt" : ".json";
  }
  if (!entry) throw new Error("not an Open Badge: expected Open Badges 2.0 or 3.0 JSON, a JWT, or a baked PNG or SVG");
  if (name && entry.achievement.name === "Badge") entry.achievement.name = name;
  return {
    entry: { id: id ?? slug(entry.achievement.name), status: "draft", confidence: "medium", ...entry, verification: { status: "unverified" } },
    original, ext,
  };
}

/**
 * Check a badge against its issuer. Only Open Badges 2.0 hosted assertions are checked so far: the
 * assertion is fetched again and compared with the original. Never fetches without `fetch`.
 * @returns {Promise<{ status, method, checkedAt? }>}
 */
export async function verifyBadge(entry, original, { fetch, now } = {}) {
  const format = entry.credential?.format;
  if (!fetch) return { status: "unverified", method: "not checked: no fetcher" };
  if (format !== "ob2-hosted" || !entry.credential.url) return { status: "unverified", method: `not implemented for ${format}` };
  const checkedAt = now ?? new Date().toISOString();
  const res = await fetch(entry.credential.url, { headers: { accept: "application/ld+json, application/json" } });
  if (!res.ok) return { status: "failed", method: "ob2-hosted: the assertion could not be fetched", checkedAt };
  const live = await res.json();
  if (live.revoked) return { status: "revoked", method: "ob2-hosted: the issuer marks it revoked", checkedAt };
  let stored;
  try { stored = JSON.parse(baked(original)?.text ?? original.toString("utf8")); } catch { stored = undefined; }
  const same = stored ? live.id === stored.id && JSON.stringify(live.recipient) === JSON.stringify(stored.recipient) && JSON.stringify(live.badge) === JSON.stringify(stored.badge) : live.id === entry.credential.url;
  return same ? { status: "verified", method: "ob2-hosted: re-fetched and matched", checkedAt } : { status: "failed", method: "ob2-hosted: the issuer's copy differs", checkedAt };
}

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return o;
}
