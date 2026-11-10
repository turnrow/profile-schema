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
