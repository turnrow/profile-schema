// Registry and tax identifiers: privacy defaults, check digits, and what a given output may show.

/** Tax identifiers are private unless the profile says otherwise; registry ids are public. */
export const PRIVATE_BY_DEFAULT = new Set(["ein", "stateTaxId"]);

export const visibilityOf = (identifier) =>
  identifier.visibility ?? (PRIVATE_BY_DEFAULT.has(identifier.scheme) ? "private" : "public");

/**
 * May this identifier appear in an output? Either its visibility is one the output includes, or
 * the output is a release to an audience the identifier names.
 */
export function identifierShown(identifier, { visibilities, audienceId } = {}) {
  if (audienceId && (identifier.audiences ?? []).includes(audienceId)) return true;
  return (visibilities ?? ["public"]).includes(visibilityOf(identifier));
}

/** An organization with only the identifiers the output may show. */
export function withShownIdentifiers(org, opts) {
  if (!org?.identifiers) return org;
  return { ...org, identifiers: org.identifiers.filter((i) => identifierShown(i, opts)) };
}

/** ISO 17442 LEI check digits (ISO 7064 MOD 97-10): letters become 10–35, the number mod 97 must be 1. */
export function leiValid(lei) {
  if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(lei)) return false;
  const digits = [...lei].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** Normalize for comparison: upper case, no separators. */
export const normalizeId = (scheme, value) => String(value).toUpperCase().replace(scheme === "opencorporates" ? /\s/g : /[\s-]/g, "");
