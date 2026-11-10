// Open Badges 3.0 and CLR 2.0 (1EdTech, on the W3C Verifiable Credentials Data Model 2.0).
//  - A Verifiable Presentation that carries the subject's original, issuer-signed credentials untouched.
//  - A Comprehensive Learner Record (ClrCredential) template that gathers them with the subject's
//    other achievements, for an institution, or the holder, to sign.
// Nothing here signs anything: we never speak as an issuer. Both documents are unsigned.
// What goes in is decided by mappings/ob3.json, like every other output.

import { createHash } from "node:crypto";
import { readBundleMedia } from "./gedcom.mjs";

export const CONTEXT_VC = "https://www.w3.org/ns/credentials/v2";
export const CONTEXT_OB3 = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
export const CONTEXT_CLR = "https://purl.imsglobal.org/spec/clr/v2p0/context-2.0.1.json";

/** The profile has nothing this output can carry. Not a fault in the profile: most have no such badge. */
export class NothingToExportError extends Error {
  constructor(message) { super(message); this.name = "NothingToExportError"; }
}

/** A stable urn:uuid made from text, so the same input always gets the same id. */
export function urnUuid(...parts) {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * A badge's original credential, ready to sit in a presentation: the JSON-LD object as issued, or
 * a VC-JWT in the envelope the Data Model defines for it. Open Badges 2.0 originals are not
 * Verifiable Credentials and return undefined.
 * @param {object} badge  a badges[] entry
 * @param {(bundlePath: string, sha256?: string) => Buffer} read  reads a file from the bundle, checking its hash
 */
export function originalCredential(badge, read) {
  const c = badge?.credential;
  if (!c?.file || !["ob3-jsonld", "ob3-jwt"].includes(c.format)) return undefined;
  const bytes = read(c.file, c.sha256);
  const text = bytes.toString("utf8").replace(/^﻿/, "").trim();
  if (c.format === "ob3-jwt") return { "@context": CONTEXT_VC, id: `data:application/vc+jwt,${text}`, type: "EnvelopedVerifiableCredential" };
  return JSON.parse(text);
}

/**
 * A reader of original files in a bundle folder, for convert()'s readBundleFile option. It refuses
 * paths that leave the bundle, and a file that no longer matches its recorded hash.
 */
export function bundleFileReader(bundleDir) {
  return (bundlePath, sha256) => {
    const [{ data }] = readBundleMedia(bundleDir, [bundlePath.replace(/^bundle:/, "")]);
    if (sha256 && createHash("sha256").update(data).digest("hex") !== sha256) throw new Error(`${bundlePath} does not match its recorded sha256; the original has changed`);
    return data;
  };
}

const holderOf = (view) => view.holder?.id ?? urnUuid("holder", view.holder?.name ?? "");

/** The unsigned Verifiable Presentation of a view made by mappings/ob3.json. */
export function renderPresentation(view) {
  const credentials = (view.credentials ?? []).map((c) => c.credential).filter(Boolean);
  if (!credentials.length) throw new NothingToExportError("there is nothing to present: the profile has no approved, public badge in good standing with an Open Badges 3.0 original in the bundle");
  return {
    "@context": [CONTEXT_VC],
    type: ["VerifiablePresentation"],
    ...(view.holder?.id ? { holder: view.holder.id } : {}),
    verifiableCredential: credentials,
  };
}

/** The unsigned ClrCredential template of the same view. A CLR must carry at least one verifiable credential. */
export function renderClr(view) {
  const credentials = (view.credentials ?? []).map((c) => c.credential).filter(Boolean);
  if (!credentials.length) throw new NothingToExportError("a CLR needs at least one Verifiable Credential, and the profile has no approved, public badge in good standing with an Open Badges 3.0 original in the bundle");
  const holder = holderOf(view);
  // A badge that stands for a license or certification is counted once: the badge is kept, the plain entry dropped.
  const represented = new Set([...(view.credentials ?? []), ...(view.achievements ?? [])].map((x) => x.represents).filter(Boolean));
  const achievements = (view.achievements ?? []).filter((a) => !represented.has(a.id)).map((a) => {
    const out = {
      id: a.url ?? urnUuid("achievement", holder, a.id),
      type: ["Achievement"],
      ...(a.achievementType ? { achievementType: a.achievementType } : {}),
      name: a.name,
      // The standard requires a description and criteria; where the profile has none, they say plainly what is known.
      description: a.description ?? a.name,
      criteria: a.criteriaUrl || a.criteria ? { ...(a.criteriaUrl ? { id: a.criteriaUrl } : {}), ...(a.criteria ? { narrative: a.criteria } : {}) } : { narrative: a.issuerName ? `As recorded by ${a.issuerName}.` : "Not recorded." },
      ...(a.issuerName ? { creator: { id: a.issuerId ?? urnUuid("issuer", a.issuerName), type: ["Profile"], name: a.issuerName } } : {}),
      ...(a.alignment?.length ? { alignment: a.alignment.map((x) => ({ type: ["Alignment"], targetName: x.targetName, targetUrl: x.targetUrl, ...(x.targetDescription ? { targetDescription: x.targetDescription } : {}), ...(x.targetFramework ? { targetFramework: x.targetFramework } : {}), ...(x.targetCode ? { targetCode: x.targetCode } : {}) })) } : {}),
      ...(a.tags?.length ? { tag: a.tags } : {}),
    };
    return out;
  });
  return {
    "@context": [CONTEXT_VC, CONTEXT_CLR, CONTEXT_OB3],
    id: urnUuid("clr", holder, view.date ?? "", JSON.stringify(credentials).length),
    type: ["VerifiableCredential", "ClrCredential"],
    name: view.name,
    // A template: whoever signs it replaces the issuer with their own profile. Until then it names the holder.
    issuer: { id: holder, type: ["Profile"], name: view.holder?.name },
    validFrom: `${view.date}T00:00:00Z`,
    credentialSubject: {
      id: holder,
      type: ["ClrSubject"],
      verifiableCredential: credentials,
      ...(achievements.length ? { achievement: achievements } : {}),
    },
  };
}
