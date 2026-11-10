// The Europass CV, in the format the Europass editor (europass.europa.eu) imports and exports:
// an HR-XML 3 "Candidate" document with Europass and EURES extensions. The European Commission
// documents its vocabulary (ECV Schema Documentation v3.0.0, 2020) but does not publish its XSD, so
// what the editor's importer reads, requires and rejects is taken from "europass-cv" by Stefano
// Zeppieri (CC BY 4.0, https://github.com/J0ker98/europass-cv), who established it from the editor's
// own exports and importer in 2026. See README, "Europass".
//
// What goes in is decided by mappings/europass.json: the résumé view, plus the exact dates and codes
// this format wants under "europass".

import { createHash } from "node:crypto";

const NS = {
  "": "http://www.europass.eu/1.0",
  oa: "http://www.openapplications.org/oagis/9",
  eures: "http://www.europass_eures.eu/1.0",
  hr: "http://www.hr-xml.org/3",
  xsi: "http://www.w3.org/2001/XMLSchema-instance",
};

// ---------- closed lists the editor checks (copied in the reference above on 18 September 2026) ----------
export const PROFILE_LANGUAGES = ["en", "bg", "hr", "cs", "da", "nl", "et", "fi", "fr", "de", "el", "hu", "is", "ga", "it", "lv", "lt", "mk", "mt", "no", "pl", "pt", "ro", "sr", "sk", "sl", "es", "sv", "tr", "uk", "me"];
export const SOCIAL_MEDIA = ["facebook", "twitter", "instagram", "linkedin", "youtube", "pinterest", "tumblr"];
export const CEFR_DIMENSIONS = ["CEF-Understanding-Listening", "CEF-Understanding-Reading", "CEF-Speaking-Interaction", "CEF-Speaking-Production", "CEF-Writing-Production"];
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const SECTIONS = ["work-experience", "education-training", "language", "profile-skills", "driving-licence", "publication", "membership", "social-or-political-activity", "conference-seminar", "recommendation", "projects", "skills-assessment", "honour-award", "hobbies-interests", "creative-works", "volunteering", "certifications"];

// ISO 639-1 to ISO 639-2 (terminology codes, as the editor writes them: fra, deu). A language that is
// not here is written by its name instead (the format's FREE_TEXT form), so nothing is guessed.
const ISO639_2 = {
  ar: "ara", bg: "bul", bn: "ben", bs: "bos", ca: "cat", cs: "ces", cy: "cym", da: "dan", de: "deu", el: "ell", en: "eng", es: "spa",
  et: "est", eu: "eus", fa: "fas", fi: "fin", fr: "fra", ga: "gle", gl: "glg", he: "heb", hi: "hin", hr: "hrv", hu: "hun", hy: "hye",
  id: "ind", is: "isl", it: "ita", ja: "jpn", ka: "kat", ko: "kor", lb: "ltz", lt: "lit", lv: "lav", mk: "mkd", mt: "mlt", nl: "nld",
  no: "nor", nb: "nob", nn: "nno", pl: "pol", pt: "por", ro: "ron", ru: "rus", sk: "slk", sl: "slv", sq: "sqi", sr: "srp", sv: "swe",
  sw: "swa", th: "tha", tr: "tur", uk: "ukr", ur: "urd", vi: "vie", zh: "zho",
};
export const iso6392 = (tag) => ISO639_2[String(tag ?? "").toLowerCase().split("-")[0]];

/**
 * The country calling code at the start of an international number, by the layout of the E.164
 * numbering zones (which codes are one, two or three digits long). Returns [code, rest] in digits,
 * or undefined when the number is not written internationally ("+…"): the country can't be guessed.
 */
export function splitPhone(phone) {
  const s = String(phone ?? "").trim();
  if (!s.startsWith("+")) return undefined;
  const d = s.replace(/\D/g, "");
  const two = { 2: "07", 3: "0123469", 4: "01345678 9".replace(" ", ""), 5: "12345678", 6: "0123456", 8: "1246", 9: "0123458" };
  const len = d[0] === "1" || d[0] === "7" ? 1 : two[d[0]]?.includes(d[1]) ? 2 : 3;
  if (d.length <= len + 3) return undefined;
  return [d.slice(0, len), d.slice(len)];
}

/** Whether a date string (YYYY, YYYY-MM or YYYY-MM-DD) names a real day: the importer refuses 1990-02-31. */
export function realDate(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(s ?? ""));
  if (!m) return false;
  const [y, mo, day] = [Number(m[1]), m[2] ? Number(m[2]) : 1, m[3] ? Number(m[3]) : 1];
  const dt = new Date(Date.UTC(y, mo - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === day;
}

// ---------- writing XML ----------
// Characters XML 1.0 does not allow are dropped; the five that need it are escaped.
const xml = (s) => String(s).replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const has = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);

/** el("hr:Name", {attr}, child, child…): children are strings (text) or nodes; empty ones are dropped. */
function el(name, attrs, ...children) {
  if (attrs != null && (typeof attrs !== "object" || Array.isArray(attrs) || Array.isArray(attrs.children))) { children.unshift(attrs); attrs = undefined; }
  return { name, attrs: attrs ?? {}, children: children.flat(Infinity).filter(has) };
}
/** An element only when it has something to say. */
const opt = (name, attrs, ...children) => { const n = el(name, attrs, ...children); return n.children.length ? n : undefined; };

function write(node, depth = 0) {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(node.attrs).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${xml(v)}"`).join("");
  if (!node.children.length) return `${pad}<${node.name}${attrs}/>\n`;
  if (node.children.every((c) => typeof c !== "object")) return `${pad}<${node.name}${attrs}>${xml(node.children.join(""))}</${node.name}>\n`;
  return `${pad}<${node.name}${attrs}>\n${node.children.map((c) => (typeof c === "object" ? write(c, depth + 1) : `${pad}  ${xml(c)}\n`)).join("")}${pad}</${node.name}>\n`;
}

// Long texts are HTML, kept as text: the importer unescapes it once and shows rich text.
const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraphs = (text) => String(text ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${html(p)}</p>`).join("");
const list = (items) => { const li = (items ?? []).filter(has).map((b) => `<li>${html(b)}</li>`).join(""); return li ? `<ul>${li}</ul>` : ""; };
const rich = (...parts) => parts.filter(has).join("");

const uuid = (...parts) => {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const date = (d) => (realDate(d) ? el("hr:FormattedDateTime", d) : undefined);
const country = (c) => (/^[A-Za-z]{2}$/.test(c ?? "") ? c.toLowerCase() : undefined);
const orgContact = (e) => opt("OrganizationContact",
  opt("Communication", opt("Address", opt("oa:CityName", e.city), opt("CountryCode", country(e.countryCode)))),
  e.website ? el("Communication", el("ChannelCode", "Web"), el("oa:URI", e.website)) : undefined);

/** The résumé view's sections that have no place of their own in a Europass CV. */
const NATIVE = new Set(["experience", "education", "languages", "publications"]);

/**
 * @param {object} view  the output of mappings/europass.json
 * @returns {string} the Candidate XML document
 */
export function renderEuropass(view) {
  const e = view.europass ?? {};
  const p = e.person ?? {};
  if (!has(p.given) && !has(p.family)) throw new Error("a Europass CV needs the person's name (the editor refuses a file without one)");
  const language = PROFILE_LANGUAGES.includes(String(e.language ?? "").toLowerCase().split("-")[0]) ? e.language.toLowerCase().split("-")[0] : "en";
  const id = uuid("europass", e.id ?? view.person?.name ?? "", view.madeFor ?? "");
  // The importer splits a name into given and family names; a single name goes whole into the given name.
  const personName = el("PersonName", opt("oa:GivenName", p.given ?? p.family), opt("hr:FamilyName", p.given ? p.family : undefined));
  const email = p.email ? el("Communication", el("ChannelCode", "Email"), el("oa:URI", p.email)) : undefined;

  const phone = splitPhone(p.phone);
  const links = [...(p.website ? [{ network: "", url: p.website }] : []), ...(p.profiles ?? [])].filter((l) => /^https?:\/\//.test(l.url ?? ""));
  const social = (l) => SOCIAL_MEDIA.find((s) => s === String(l.network ?? "").toLowerCase() || (s === "twitter" && /^x$/i.test(l.network ?? "")));

  const candidatePerson = el("CandidatePerson",
    personName,
    email,
    links.map((l) => (social(l)
      ? el("Communication", el("ChannelCode", "Social Media"), el("UseCode", social(l)), el("oa:URI", l.url))
      : el("Communication", el("ChannelCode", "Web"), el("oa:URI", l.url)))),
    // A telephone without its country calling code makes the editor refuse the whole file, so a
    // number that is not written internationally is left out rather than guessed.
    phone ? el("Communication", el("ChannelCode", "Telephone"), el("UseCode", "other"), el("CountryDialing", phone[0]), el("oa:DialNumber", phone[1])) : undefined,
    has(p.city) || country(p.countryCode)
      ? el("Communication", el("UseCode", "home"), el("Address", { type: "home" }, opt("oa:CityName", p.city), opt("CountryCode", country(p.countryCode)), opt("oa:PostalCode", p.postalCode)))
      : undefined,
    (e.languages ?? []).filter((l) => l.native).map((l) => (iso6392(l.tag)
      ? el("PrimaryLanguageCode", { name: "NORMAL" }, iso6392(l.tag))
      : el("PrimaryLanguageCode", { name: "FREE_TEXT" }, l.name ?? l.tag))));

  const work = (e.work ?? []).map((w) => el("EmployerHistory",
    el("hr:OrganizationName", w.organization ?? ""),
    orgContact(w),
    el("PositionHistory",
      el("PositionTitle", { typeCode: "FREETEXT" }, w.title ?? ""),
      el("eures:EmploymentPeriod",
        opt("eures:StartDate", date(w.start)),
        w.current ? undefined : opt("eures:EndDate", date(w.end)),
        el("hr:CurrentIndicator", w.current ? "true" : "false")),
      opt("oa:Description", rich(paragraphs(w.dateNote), paragraphs(w.summary), list(w.bullets))),
      opt("City", w.city),
      opt("Country", country(w.countryCode)))));

  const education = (e.education ?? []).map((s) => el("EducationOrganizationAttendance",
    el("hr:OrganizationName", s.institution ?? ""),
    orgContact(s),
    el("AttendancePeriod", opt("StartDate", date(s.start)), opt("EndDate", date(s.end)), el("Ongoing", s.ongoing ? "true" : "false")),
    el("EducationDegree",
      el("hr:DegreeName", s.degree ?? s.institution ?? ""),
      opt("OccupationalSkillsCovered", rich(paragraphs(s.dateNote), paragraphs(s.note), paragraphs(s.summary))),
      s.score ? el("FinalGrade", el("hr:ScoreText", s.score)) : undefined)));

  const spoken = (e.languages ?? []).filter((l) => !l.native).map((l) => el("PersonCompetency",
    iso6392(l.tag) ? el("CompetencyID", { schemeName: "NORMAL" }, iso6392(l.tag)) : el("CompetencyID", { schemeName: "FREE_TEXT" }, l.name ?? l.tag),
    el("hr:TaxonomyID", "language"),
    // The profile holds one level for a language; Europass asks for five skills, so each gets that level.
    CEFR_LEVELS.includes(l.cefr) ? CEFR_DIMENSIONS.map((d) => el("eures:CompetencyDimension", el("hr:CompetencyDimensionTypeCode", d), el("eures:Score", el("hr:ScoreText", l.cefr)))) : undefined));

  const publications = (e.publications ?? []).map((x) => el("Publication",
    opt("hr:FormattedPublicationDescription", paragraphs(x.summary)),
    el("Title", x.title ?? ""),
    opt("Year", /^\d{4}/.test(x.date ?? "") ? x.date.slice(0, 4) : undefined),
    opt("Reference", x.url),
    x.doi ? el("DOI", el("Link", x.doi)) : undefined,
    opt("Authors", (x.authors ?? []).join(view.separators?.list ?? ", ")),
    opt("Publisher", x.publisher)));

  // Everything else becomes a custom section. The importer keeps only the last entry of a section
  // element, so each entry gets a section element of its own under the same title, which it merges.
  const brief = (s) => s.entries.every((x) => !(x.dates || x.organization || x.summary || x.bullets?.length || x.url));
  const sep = view.separators ?? { list: ", ", item: "; " };
  const others = (view.sections ?? []).filter((s) => !NATIVE.has(s.id)).flatMap((s) => (brief(s)
    // Skills and the like: one entry listing them, each with its level in brackets.
    ? [el("Others", el("Title", s.heading), el("Other", el("Title", s.heading),
        el("Description", paragraphs(s.entries.map((x) => { const extra = [x.detail, ...(x.keywords ?? [])].filter(has).join(sep.list); return extra ? `${x.title} (${extra})` : x.title; }).join(sep.item)))))]
    : s.entries.map((x) => el("Others", el("Title", s.heading), el("Other",
        el("Title", x.title ?? x.organization ?? s.heading),
        opt("Description", rich(paragraphs([x.title ? x.organization : undefined, x.detail, x.location, x.dates].filter(has).join(sep.list)), paragraphs(x.summary), list(x.bullets))),
        x.url ? el("Link", x.url) : undefined)))));

  const shown = [work.length && "work-experience", education.length && "education-training", spoken.length && "language", publications.length && "publication"].filter(Boolean);

  const root = el("Candidate", {
    "xsi:schemaLocation": `${NS[""]} Candidate.xsd`,
    xmlns: NS[""], "xmlns:oa": NS.oa, "xmlns:eures": NS.eures, "xmlns:hr": NS.hr, "xmlns:xsi": NS.xsi,
  },
    { name: "hr:DocumentID", attrs: { schemeID: id, schemeName: "DocumentIdentifier", schemeAgencyName: "EUROPASS", schemeVersionID: "4.0" }, children: [] },
    el("CandidateSupplier",
      { name: "hr:PartyID", attrs: { schemeID: id, schemeName: "PartyID", schemeAgencyName: "EUROPASS", schemeVersionID: "1.0" }, children: [] },
      el("hr:PartyName", "Owner"),
      el("PersonContact", personName, email),
      el("hr:PrecedenceCode", "1")),
    candidatePerson,
    el("CandidateProfile", { languageCode: language },
      opt("hr:ExecutiveSummary", paragraphs(view.summary?.text)),
      opt("EmploymentHistory", work),
      opt("EducationHistory", education),
      opt("PublicationHistory", publications),
      opt("PersonQualifications", spoken),
      others),
    // Without the list of sections to show, the editor imports the data and displays only the personal details.
    el("RenderingInformation", el("Design",
      el("Template", "Template1"), el("Color", "Default"), el("FontSize", "Medium"), el("Logo", "FirstPage"), el("PageNumbers", "true"),
      opt("SectionsOrder", shown.map((t) => el("Section", el("Title", t)))))));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${write(root)}`;
}
