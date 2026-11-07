// Audiences: resolve who an audience is at a given moment, and check whether a requester qualifies.
//
// This module enforces policy, not cryptography. Before calling checkRequester, the application
// must already have verified the requester's proof (validated the OIDC/SAML token, looked up the
// DNS TXT record or .well-known file, checked the request signature). It then reports the method
// and domain it verified, and this module decides whether that satisfies the audience.

const VERIFICATION_STRENGTH = { emailDomain: 1, dnsTxt: 2, wellKnown: 2, signedRequest: 3, saml: 3, oidc: 3 };
export const DEFAULT_METHODS = ["oidc", "saml", "dnsTxt", "wellKnown", "signedRequest"];
export const DEFAULT_WRITEBACK_METHODS = ["oidc", "saml", "signedRequest"];

/** Fields an employer may send back, and who is authoritative for each by default. */
export const DEFAULT_AUTHORITY = [
  { field: "employerRecord.*", authority: "employer" },
  { field: "startDate", authority: "employer" },
  { field: "endDate", authority: "employer" },
  { field: "title", authority: "subject" },
  { field: "person.*", authority: "subject" },
];

const today = () => new Date().toISOString().slice(0, 10);
const lower = (d) => (d == null ? undefined : typeof d === "string" ? d : d.value ?? d.between?.[0]);

function orgOf(profile, ref) {
  if (ref == null) return undefined;
  if (typeof ref === "string") return profile.organizations?.[ref] ? { id: ref, ...profile.organizations[ref] } : undefined;
  return ref;
}

/** Is a work entry current on a given date (ISO yyyy-mm-dd)? */
export function isCurrent(work, on = today()) {
  const start = lower(work.startDate);
  if (start && start > on) return false;
  if (work.current) return true;
  const end = lower(work.endDate);
  return !end || end >= on.slice(0, end.length);
}

/**
 * Resolve an audience to the organizations and work entries it covers right now.
 * @returns {{ id, audience, active: boolean, reason?: string, bindings: {work?: object, organization: object}[] }}
 */
export function resolveAudience(profile, audienceId, { on = today() } = {}) {
  const audience = profile.audiences?.[audienceId];
  if (!audience) throw new Error(`Unknown audience: ${audienceId}`);
  const result = { id: audienceId, audience, active: false, bindings: [] };

  if (typeof audience.expires === "string" && /^\d{4}/.test(audience.expires) && audience.expires < on.slice(0, audience.expires.length)) {
    return { ...result, reason: `audience expired ${audience.expires}` };
  }

  const work = profile.work ?? [];
  let candidates = [];
  if (audience.workRef) {
    candidates = work.filter((w) => w.id === audience.workRef);
  } else if (audience.organization) {
    const org = orgOf(profile, audience.organization);
    if (audience.kind === "employer" || audience.kind === "client") {
      const id = typeof audience.organization === "string" ? audience.organization : undefined;
      candidates = work.filter((w) => (id ? w.organization === id || w.client === id : false));
      if (!candidates.length) result.bindings.push({ organization: org });
    } else {
      result.bindings.push({ organization: org });
    }
  } else if (audience.relation) {
    candidates = work.filter((w) => w.status !== "retired");
  }

  for (const w of candidates) {
    const key = audience.kind === "client" ? w.client : w.organization;
    const org = orgOf(profile, key);
    if (!org) continue;
    const current = isCurrent(w, on);
    if (audience.relation === "current" && !current) continue;
    if (audience.relation === "former" && current) continue;
    result.bindings.push({ work: w, organization: org });
  }

  // "onSeparation": an audience tied to current work lapses once none of its jobs is current.
  // Audiences for former or any employers are about past jobs too, so separation never ends them.
  const expires = audience.expires ?? (audience.relation === "former" || audience.relation === "any" ? "never" : "onSeparation");
  if (expires === "onSeparation" && result.bindings.some((b) => b.work)) {
    result.bindings = result.bindings.filter((b) => !b.work || isCurrent(b.work, on));
    if (!result.bindings.length) return { ...result, reason: "the job this audience depends on has ended" };
  }

  if (!result.bindings.length) return { ...result, reason: "no organization currently qualifies for this audience" };
  return { ...result, active: true };
}

/**
 * Decide whether a verified requester qualifies for an audience.
 * @param requester {{ domain: string, method: string, application?: string }}  what the application verified
 * @param [opts] {{ writeBack?: boolean, on?: string }}
 * @returns {{ ok: boolean, reason?: string, binding?: object }}
 */
export function checkRequester(profile, audienceId, requester, { writeBack = false, on } = {}) {
  const resolved = resolveAudience(profile, audienceId, { on });
  if (!resolved.active) return { ok: false, reason: resolved.reason };
  const { audience } = resolved;

  const allowed = writeBack
    ? audience.verification?.writeBackMethods ?? DEFAULT_WRITEBACK_METHODS
    : audience.verification?.methods ?? DEFAULT_METHODS;
  if (writeBack && !audience.writeBack?.allowed) return { ok: false, reason: "this audience may not write back" };
  if (writeBack && requester.method === "emailDomain") return { ok: false, reason: "an email address is never enough to write back" };
  if (!allowed.includes(requester.method)) {
    return { ok: false, reason: `verification by ${requester.method} is not accepted for this audience (accepted: ${allowed.join(", ")})` };
  }
  if (!(requester.method in VERIFICATION_STRENGTH)) return { ok: false, reason: `unknown verification method ${requester.method}` };

  const domain = String(requester.domain ?? "").toLowerCase().replace(/\.$/, "");
  const binding = resolved.bindings.find((b) => (b.organization.domains ?? []).some((d) => domain === d || domain.endsWith(`.${d}`)));
  if (!binding) return { ok: false, reason: `${domain || "(no domain)"} does not belong to an organization this audience covers` };
  return { ok: true, binding };
}

/** The authority for a field under an audience's write-back rules (first match wins; '*' matches the rest). */
export function authorityFor(audience, field) {
  const rules = [...(audience.writeBack?.authority ?? []), ...DEFAULT_AUTHORITY];
  for (const r of rules) {
    if (r.field === field) return r.authority;
    if (r.field.endsWith(".*") && field.startsWith(r.field.slice(0, -1))) return r.authority;
  }
  return "subject";
}
