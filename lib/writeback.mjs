// Write-back: an employer's system returns corrections (as a SCIM User). Each value becomes a
// claim cited to the employer's system of record. Values the employer is authoritative for are
// accepted unless the job entry is locked; everything else is kept as a suggestion for the subject.
// Nothing is overwritten without leaving the previous value behind as a claim.

import { checkRequester, authorityFor } from "./audience.mjs";
import { getField, canonical, validateProfile } from "./validate.mjs";

const ENT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const EXT = "urn:turnrow:params:scim:schemas:extension:profile:2.0:User";

/** Pull the fields this project understands out of a SCIM User, as [field, value] pairs. */
export function readScim(user) {
  const ent = user[ENT] ?? {};
  const ext = user[EXT] ?? {};
  const pairs = [
    ["employerRecord.officialTitle", user.title],
    ["employerRecord.department", ent.department],
    ["employerRecord.division", ent.division],
    ["employerRecord.costCenter", ent.costCenter],
    ["employerRecord.employeeNumber", ent.employeeNumber ?? user.externalId],
    ["employerRecord.managerId", ent.manager?.value],
    ["employerRecord.managerName", ent.manager?.displayName],
    ["employerRecord.workLocation", ext.workLocation],
    ["employerRecord.hireDate", ext.hireDate],
    ["employerRecord.employmentStatus", user.active === false ? "separated" : ext.employmentStatus],
    ["startDate", ext.startDate],
    ["endDate", ext.endDate],
    ["person.name", user.displayName],
    ["person.names.preferred.given", user.name?.givenName],
    ["person.names.preferred.family", user.name?.familyName],
    ["person.names.nickname", user.nickName],
    ["person.pronouns", ext.pronouns],
  ];
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== "");
}

const DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const DATE_FIELDS = new Set(["startDate", "endDate", "employerRecord.hireDate"]);
const STATUSES = new Set(["active", "leave", "separated"]);

/** Why an incoming value can't be used, or undefined if it can. Values come from another system: check them. */
function invalidValue(field, value) {
  if (typeof value !== "string") return "not text";
  if (value.length > 300) return "longer than 300 characters";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return "contains control characters";
  if (DATE_FIELDS.has(field) && !DATE.test(value)) return "not a date (yyyy, yyyy-mm or yyyy-mm-dd)";
  if (field === "employerRecord.employmentStatus" && !STATUSES.has(value)) return "not active, leave or separated";
  return undefined;
}

function personValue(person, field) {
  const preferred = (person.names ?? []).find((n) => n.type === "preferred");
  const nickname = (person.names ?? []).find((n) => n.type === "nickname");
  switch (field) {
    case "person.name": return person.name;
    case "person.pronouns": return person.pronouns;
    case "person.names.preferred.given": return preferred?.given;
    case "person.names.preferred.family": return preferred?.family;
    case "person.names.nickname": return nickname?.full;
    default: return undefined;
  }
}

function setField(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
  cur[parts.at(-1)] = value;
}

/**
 * @param {object} profile
 * @param {string} audienceId
 * @param {object} scimUser   the SCIM User the employer sent back
 * @param {{ requester: {domain: string, method: string, application?: string}, now?: string, on?: string }} opts
 * @returns {{ profile: object, changes: {field: string, from?: any, to: any, action: string}[], suggestions: {field: string, value: any}[] }}
 */
export function applyWriteBack(profile, audienceId, scimUser, opts) {
  if (!opts?.requester) throw new Error("Write-back needs a verified requester");
  const check = checkRequester(profile, audienceId, opts.requester, { writeBack: true, on: opts.on });
  if (!check.ok) throw new Error(`Write-back refused: ${check.reason}`);
  const binding = check.binding;
  if (!binding.work) throw new Error("Write-back needs an audience bound to a work entry");

  const now = opts.now ?? new Date().toISOString();
  const out = structuredClone(profile);
  const audience = out.audiences[audienceId];
  const work = out.work.find((w) => w.id === binding.work.id);
  const orgName = typeof binding.organization.name === "string" ? binding.organization.name : Object.values(binding.organization.name)[0];

  // Sources are added only when a claim cites them, so a no-op sync leaves the profile unchanged.
  out.sources ??= {};
  const sourceId = `writeback-${audienceId}-${now.slice(0, 10)}`;
  const ownerSource = "profile-owner";
  const cite = (id) => {
    if (id === sourceId) out.sources[sourceId] ??= {
      title: `${orgName} system of record (SCIM write-back)`, kind: "record", date: now.slice(0, 10),
      author: opts.requester.domain, defaultQuality: "primary",
    };
    if (id === ownerSource) out.sources[ownerSource] ??= { title: "Entered by the profile owner", kind: "bio", defaultQuality: "selfReported" };
    return { source: id };
  };

  const changes = [];
  const suggestions = [];
  for (const [field, value] of readScim(scimUser)) {
    const problem = invalidValue(field, value);
    if (problem) { changes.push({ field, to: value, action: "rejected", reason: problem }); continue; }
    if (field.startsWith("person.")) {
      const current = personValue(out.person, field);
      if (canonical(current) !== canonical(value)) suggestions.push({ field, value, current });
      continue;
    }
    const stored = getField(work, field);
    // A translated field is compared on its default-language text.
    const localized = stored && typeof stored === "object" && !Array.isArray(stored);
    const defaultKey = localized ? (stored[out.meta.defaultLocale] !== undefined ? out.meta.defaultLocale : Object.keys(stored)[0]) : undefined;
    const current = localized ? stored[defaultKey] : stored;
    if (canonical(current) === canonical(value)) { changes.push({ field, to: value, action: "unchanged" }); continue; }

    work.claims ??= [];
    const employerClaim = { field, value, citations: [cite(sourceId)] };
    const authority = authorityFor(audience, field);

    // A lock protects approved values from changing; it does not stop an empty field being filled.
    if (authority === "employer" && (!work.lock || current === undefined)) {
      if (current !== undefined && !work.claims.some((c) => c.field === field && canonical(c.value) === canonical(current))) {
        work.claims.push({ field, value: current, citations: work.citations?.length ? [work.citations[0]] : [cite(ownerSource)] });
      }
      for (const c of work.claims) if (c.field === field) delete c.accepted;
      work.claims.push({ ...employerClaim, accepted: true, rationale: `${orgName}'s records are authoritative for this field.` });
      if (localized) {
        // Keep the other translations, but say they may now be out of date.
        setField(work, field, { ...stored, [defaultKey]: value });
        employerClaim.value = value;
        const q = `${field} changed in ${defaultKey}; check its translations (${Object.keys(stored).filter((k) => k !== defaultKey).join(", ")}).`;
        work.openQuestion = work.openQuestion ? `${work.openQuestion} ${q}` : q;
      } else {
        setField(work, field, value);
      }
      changes.push({ field, from: current, to: value, action: "accepted" });
    } else {
      // Locked entries and subject-authoritative fields keep their value; the employer's value waits for review.
      work.claims.push(employerClaim);
      // The kept value is the accepted claim, so later conflicting reports still validate.
      const kept = work.claims.find((c) => c.field === field && canonical(c.value) === canonical(current));
      if (kept) kept.accepted = true;
      else work.claims.push({
        field, value: current, accepted: true, rationale: work.lock ? "Locked by the subject." : "The subject is authoritative for this field.",
        citations: work.citations?.length ? [work.citations[0]] : [cite(ownerSource)],
      });
      for (const c of work.claims) if (c.field === field && c !== kept && c.accepted && canonical(c.value) !== canonical(current)) delete c.accepted;
      const why = work.lock ? "the entry is locked" : "the subject is authoritative for it";
      const q = `${orgName} reports ${field} = ${JSON.stringify(value)}; kept ${JSON.stringify(current)} because ${why}. Review.`;
      work.openQuestion = work.openQuestion ? `${work.openQuestion} ${q}` : q;
      changes.push({ field, from: current, to: value, action: "needsReview" });
    }
  }
  work.employerRecord ??= {};
  work.employerRecord.lastSynced = now;
  out.meta.updated = now;
  // Belt and braces: a write-back never hands back a profile that doesn't validate.
  const after = validateProfile(out);
  if (!after.valid) throw new Error(`Write-back would make the profile invalid:\n  ${after.errors.join("\n  ")}`);
  return { profile: out, changes, suggestions };
}
