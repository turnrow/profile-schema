// A checker for the Europass Candidate XML, written from what is known of the editor's importer
// (see lib/europass.mjs for the sources): well-formed XML, the right namespaces, and the rules whose
// breach makes the editor refuse a file or flag a field. It is not the official schema, which the
// European Commission does not publish.
import { PROFILE_LANGUAGES, SOCIAL_MEDIA, CEFR_DIMENSIONS, CEFR_LEVELS, SECTIONS, realDate } from "../lib/europass.mjs";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  if (!(e in ENTITIES)) throw new Error(`unknown entity ${m}`);
  return ENTITIES[e];
});

/** A small XML parser: elements, attributes and text. Throws on anything not well formed. */
export function parseXml(text) {
  const decl = /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>\n/.exec(text);
  if (!decl) throw new Error("the XML declaration is missing or not the one the editor writes");
  let i = decl[0].length;
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  while (i < text.length) {
    if (text[i] === "<") {
      const end = text.indexOf(">", i);
      if (end < 0) throw new Error("an unclosed tag");
      const tag = text.slice(i + 1, end);
      i = end + 1;
      if (tag[0] === "/") {
        const open = stack.pop();
        if (open.name !== tag.slice(1).trim()) throw new Error(`</${tag.slice(1)}> closes <${open.name}>`);
        continue;
      }
      const selfClosing = tag.endsWith("/");
      const m = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[\w:.-]+="[^"<]*")*)\s*\/?$/.exec(tag);
      if (!m) throw new Error(`a malformed tag: <${tag}>`);
      const attrs = {};
      for (const a of m[2].matchAll(/([\w:.-]+)="([^"<]*)"/g)) {
        if (a[1] in attrs) throw new Error(`attribute ${a[1]} twice on <${m[1]}>`);
        attrs[a[1]] = unescape(a[2]);
      }
      const node = { name: m[1], attrs, children: [], text: "" };
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    } else {
      const next = text.indexOf("<", i);
      const raw = text.slice(i, next < 0 ? text.length : next);
      if (/&(?!(#x[0-9a-fA-F]+|#\d+|\w+);)/.test(raw)) throw new Error("a bare & in text");
      stack.at(-1).text += unescape(raw);
      i = next < 0 ? text.length : next;
    }
  }
  if (stack.length !== 1) throw new Error(`<${stack.at(-1).name}> is never closed`);
  if (root.children.length !== 1 || root.text.trim()) throw new Error("a document has exactly one root element");
  return root.children[0];
}

export const kids = (node, name) => node.children.filter((c) => c.name === name);
export const kid = (node, name) => kids(node, name)[0];
export const at = (node, path) => path.split("/").reduce((n, p) => (n ? kid(n, p) : undefined), node);
export const textOf = (node) => (node ? node.text.trim() : undefined);
export function all(node, name, out = []) { for (const c of node.children) { if (c.name === name) out.push(c); all(c, name, out); } return out; }

// Which namespace each element belongs to, from the editor's own exports.
const PREFIX = {
  hr: ["DocumentID", "PartyID", "PartyName", "PrecedenceCode", "FamilyName", "BirthDate", "ID", "ExecutiveSummary", "OrganizationName", "IndustryCode", "FormattedDateTime", "CurrentIndicator", "DegreeName", "ScoreText", "TaxonomyID", "CompetencyDimensionTypeCode", "CompetencyName", "LicenseTypeCode", "FormattedPublicationDescription", "Instructions"],
  oa: ["GivenName", "URI", "DialNumber", "AddressLine", "CityName", "PostalCode", "Description", "EmbeddedData", "FileType"],
  eures: ["EmploymentPeriod", "StartDate", "EndDate", "CompetencyDimension", "Score", "Licenses", "License", "Attachment"],
};
const NAMESPACES = { xmlns: "http://www.europass.eu/1.0", "xmlns:oa": "http://www.openapplications.org/oagis/9", "xmlns:eures": "http://www.europass_eures.eu/1.0", "xmlns:hr": "http://www.hr-xml.org/3", "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance" };

/** @returns {string[]} problems; empty when the document passes */
export function checkEuropass(text) {
  let root;
  try { root = parseXml(text); } catch (e) { return [`not well-formed XML: ${e.message}`]; }
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(msg); };
  need(root.name === "Candidate", "the root element is Candidate");
  for (const [k, v] of Object.entries(NAMESPACES)) need(root.attrs[k] === v, `${k} is declared as ${v}`);
  need(root.attrs["xsi:schemaLocation"] === "http://www.europass.eu/1.0 Candidate.xsd", "xsi:schemaLocation names Candidate.xsd");

  const walk = (n, parent) => {
    const [prefix, local] = n.name.includes(":") ? n.name.split(":") : ["", n.name];
    const expected = Object.keys(PREFIX).find((p) => PREFIX[p].includes(local)) ?? "";
    // StartDate, EndDate and Description are EURES/OAGIS in a job and plain Europass elsewhere.
    const either = ["StartDate", "EndDate", "Description"].includes(local);
    const inJob = parent?.name === "eures:EmploymentPeriod" || parent?.name === "PositionHistory";
    if (either) need(prefix === (inJob ? expected : ""), `<${n.name}> under <${parent?.name}> has the wrong namespace`);
    else need(prefix === expected, `<${n.name}> should be ${expected ? `${expected}:` : ""}${local}`);
    need(!(n.children.length && n.text.trim()), `<${n.name}> mixes text and elements`);
    for (const c of n.children) walk(c, n);
  };
  walk(root);

  need(kids(root, "hr:DocumentID").length === 1, "exactly one hr:DocumentID");
  need(/^[0-9a-f-]{36}$/.test(kid(root, "hr:DocumentID")?.attrs.schemeID ?? ""), "the document id is a UUID");
  need(kids(root, "CandidateSupplier").length >= 1, "a CandidateSupplier");
  need(kids(root, "CandidatePerson").length === 1, "exactly one CandidatePerson");
  need(kids(root, "CandidateProfile").length >= 1, "a CandidateProfile");
  const person = kid(root, "CandidatePerson");
  need(textOf(at(person ?? root, "PersonName/oa:GivenName")), "the person has a name (the importer refuses a file without PersonName)");

  for (const c of all(root, "Communication")) {
    const channel = textOf(kid(c, "ChannelCode"));
    if (channel === "Telephone") {
      need(/^\d{1,3}$/.test(textOf(kid(c, "CountryDialing")) ?? ""), "a telephone has its CountryDialing (the importer refuses the file without it)");
      need(/^\d+$/.test(textOf(kid(c, "oa:DialNumber")) ?? ""), "a telephone number is digits");
      need(["home", "work", "mobile", "other"].includes(textOf(kid(c, "UseCode"))), "a telephone's UseCode is from the list");
    } else if (channel === "Social Media") need(SOCIAL_MEDIA.includes(textOf(kid(c, "UseCode"))), `social media type "${textOf(kid(c, "UseCode"))}" is in the editor's list`);
    else if (channel === "Web") need(/^https?:\/\/\S+$/.test(textOf(kid(c, "oa:URI")) ?? ""), "a web link is an absolute URL");
    else if (channel === "Email") need(/^\S+@\S+$/.test(textOf(kid(c, "oa:URI")) ?? ""), "an e-mail address");
    else need(channel === undefined && kid(c, "Address"), `unknown ChannelCode "${channel}"`);
  }
  for (const c of [...all(root, "CountryCode"), ...all(root, "Country"), ...all(root, "NationalityCode")]) need(/^[a-z]{2}$/.test(textOf(c)), `country "${textOf(c)}" is a lower-case two-letter code`);
  for (const d of all(root, "hr:FormattedDateTime")) need(realDate(textOf(d)), `"${textOf(d)}" is a real date as YYYY, YYYY-MM or YYYY-MM-DD (the importer refuses the file otherwise)`);
  for (const l of all(root, "PrimaryLanguageCode")) need(l.attrs.name === "FREE_TEXT" || (l.attrs.name === "NORMAL" && /^[a-z]{3}$/.test(textOf(l))), "a mother tongue is a three-letter code, or FREE_TEXT");

  for (const profile of kids(root, "CandidateProfile")) {
    need(PROFILE_LANGUAGES.includes(profile.attrs.languageCode), `profile language "${profile.attrs.languageCode}" is one the editor knows`);
    for (const e of all(profile, "EmployerHistory")) {
      need(kids(e, "PositionHistory").length === 1, "one EmployerHistory per position");
      const period = at(e, "PositionHistory/eures:EmploymentPeriod");
      need(["true", "false"].includes(textOf(kid(period ?? e, "hr:CurrentIndicator"))), "a job says whether it is current");
      need(!(textOf(kid(period ?? e, "hr:CurrentIndicator")) === "true" && kid(period, "eures:EndDate")), "a current job has no end date");
      need(at(e, "PositionHistory/PositionTitle")?.attrs.typeCode === "FREETEXT", "a position title is FREETEXT");
    }
    for (const s of all(profile, "EducationOrganizationAttendance")) {
      need(["true", "false"].includes(textOf(at(s, "AttendancePeriod/Ongoing"))), "education says whether it is ongoing");
      need(textOf(at(s, "EducationDegree/hr:DegreeName")), "education names its qualification");
    }
    for (const c of kids(kid(profile, "PersonQualifications") ?? { children: [] }, "PersonCompetency")) {
      const id = kid(c, "CompetencyID");
      need(id && (id.attrs.schemeName === "FREE_TEXT" || (id.attrs.schemeName === "NORMAL" && /^[a-z]{3}$/.test(textOf(id)))), "a language is a three-letter code, or FREE_TEXT");
      need(textOf(kid(c, "hr:TaxonomyID")) === "language", "a language competency says so");
      for (const d of kids(c, "eures:CompetencyDimension")) {
        need(CEFR_DIMENSIONS.includes(textOf(kid(d, "hr:CompetencyDimensionTypeCode"))), "a CEFR skill from the list");
        need(CEFR_LEVELS.includes(textOf(at(d, "eures:Score/hr:ScoreText"))), "a CEFR level A1 to C2");
      }
    }
    for (const o of kids(profile, "Others")) {
      need(textOf(kid(o, "Title")), "a custom section has a title");
      need(kids(o, "Other").length === 1, "one entry per Others element (the importer keeps only the last)");
      for (const x of kids(o, "Other")) need(textOf(kid(x, "Title")), "a custom entry has a non-blank title");
    }
    // Long texts are HTML kept as text: after one unescape they must be balanced p/ul/li markup.
    for (const t of [...all(profile, "hr:ExecutiveSummary"), ...all(profile, "oa:Description"), ...all(profile, "Description"), ...all(profile, "OccupationalSkillsCovered"), ...all(profile, "hr:FormattedPublicationDescription")]) {
      const h = t.text;
      need(/^(<p>[^<]*<\/p>|<ul>(<li>[^<]*<\/li>)+<\/ul>)+$/.test(h), `<${t.name}> holds paragraphs and lists only: ${h.slice(0, 60)}`);
      need(!/&(?!(amp|lt|gt);)/.test(h), `<${t.name}> escapes its own text`);
    }
  }
  const order = all(root, "SectionsOrder").flatMap((s) => kids(s, "Section")).map((s) => textOf(kid(s, "Title")));
  for (const t of order) need(SECTIONS.includes(t), `section "${t}" is one the editor knows`);
  const profile = kid(root, "CandidateProfile");
  if (profile) {
    const present = { "work-experience": "EmploymentHistory", "education-training": "EducationHistory", language: "PersonQualifications", publication: "PublicationHistory" };
    for (const [title, element] of Object.entries(present)) need(!kid(profile, element) === !order.includes(title), `${element} is listed in SectionsOrder exactly when it is present (unlisted sections are hidden)`);
  }
  return bad;
}
