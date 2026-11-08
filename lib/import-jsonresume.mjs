// Import a JSON Resume (v1.x) document into a Turnrow Profile.
// Everything imported starts as status "draft", confidence "medium", cited to one
// self-reported "import" source, so nothing is published until someone reviews it.

const slug = (s, fallback) =>
  (String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback).slice(0, 60);

// Links from another file are kept only if they are web addresses (no javascript:, data: or bare hosts).
const web = (u) => (typeof u === "string" && /^https?:\/\/\S+$/.test(u) ? u : undefined);

const isoPartial = (d) =>
  typeof d === "string" && /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(d) ? d : undefined;

const FLUENCY = [
  [/native|bilingual|mother/i, "native"],
  [/full|fluent/i, "fullProfessional"],
  [/professional/i, "professionalWorking"],
  [/limited|conversational|intermediate/i, "limitedWorking"],
  [/elementary|basic|beginner/i, "elementary"],
];
const LEVEL = [[/master|expert/i, "expert"], [/advanced|senior/i, "advanced"], [/intermediate|proficient/i, "proficient"], [/beginner|basic|familiar/i, "familiar"]];
const pick = (table, v) => (v ? table.find(([re]) => re.test(v))?.[1] : undefined);

/**
 * @param {object} resume  a JSON Resume document
 * @param {{ locale?: string, sourceTitle?: string, now?: string }} [options]
 * @returns {object} a Turnrow Profile (schemaVersion 2.0.0)
 */
export function fromJsonResume(resume, options = {}) {
  const locale = options.locale ?? "en";
  const used = new Set();
  const uid = (base) => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
  const organizations = {};
  const orgId = (name, extra = {}) => {
    if (!name) return { name: "Unknown" };
    const base = slug(name, "org");
    let id = base, n = 2;
    while (organizations[id] && organizations[id].name !== name) id = `${base}-${n++}`;
    if (!organizations[id]) organizations[id] = { name, ...extra };
    return id;
  };
  const base = (prefix, label) => ({
    id: uid(`${prefix}-${slug(label, prefix)}`),
    status: "draft",
    confidence: "medium",
    citations: [{ source: "import" }],
  });
  const range = (x) => {
    const r = {};
    const s = isoPartial(x.startDate), e = isoPartial(x.endDate);
    if (s) r.startDate = s;
    if (e) r.endDate = e; else if (s) r.current = true;
    return r;
  };
  const b = resume.basics ?? {};

  const profile = {
    schemaVersion: "2.0.0",
    meta: {
      defaultLocale: locale,
      updated: options.now ?? new Date().toISOString(),
      notes: "Imported from JSON Resume. Every entry is a draft until reviewed.",
    },
    person: {
      name: b.name ?? "Unknown",
      headline: b.label,
      summary: b.summary,
      image: web(b.image) ? { url: b.image, alt: `Portrait of ${b.name ?? "the subject"}` } : undefined,
      location: b.location ? {
        label: [b.location.city, b.location.region].filter(Boolean).join(", ") || undefined,
        locality: b.location.city, region: b.location.region, postalCode: b.location.postalCode,
        streetAddress: b.location.address,
        countryCode: /^[A-Z]{2}$/.test(b.location.countryCode ?? "") ? b.location.countryCode : undefined,
      } : undefined,
      contact: (b.email || b.phone || b.url) ? {
        email: b.email, phone: b.phone, website: web(b.url), emailVisibility: "private", phoneVisibility: "private",
      } : undefined,
      profiles: (b.profiles ?? []).filter((p) => web(p.url)).map((p) => ({ url: p.url, network: p.network, username: p.username })),
    },
    organizations,
    work: (resume.work ?? []).map((w) => ({
      ...base("work", `${w.name}-${w.position}`),
      organization: orgId(w.name, web(w.url) ? { url: w.url, kind: "company" } : { kind: "company" }),
      title: w.position ?? "Untitled role",
      ...range(w),
      location: w.location ? { label: w.location } : undefined,
      summary: w.summary ?? w.description,
      highlights: w.highlights,
    })),
    service: (resume.volunteer ?? []).map((v) => ({
      ...base("service", v.organization),
      kind: "volunteer",
      organization: orgId(v.organization, web(v.url) ? { url: v.url, kind: "nonprofit" } : { kind: "nonprofit" }),
      role: v.position,
      ...range(v),
      summary: v.summary,
      highlights: v.highlights,
    })),
    education: (resume.education ?? []).map((e) => ({
      ...base("edu", e.institution),
      institution: orgId(e.institution, web(e.url) ? { url: e.url, kind: "school" } : { kind: "school" }),
      kind: e.studyType ? "degree" : "coursework",
      credential: e.studyType,
      area: e.area,
      score: e.score,
      courses: e.courses,
      ...range(e),
    })),
    credentials: (resume.certificates ?? []).map((c) => ({
      ...base("cert", c.name),
      name: c.name ?? "Untitled certificate",
      kind: "certification",
      issuer: c.issuer ? orgId(c.issuer) : undefined,
      issued: isoPartial(c.date),
      url: web(c.url),
    })),
    awards: (resume.awards ?? []).map((a) => ({
      ...base("award", a.title),
      title: a.title ?? "Untitled award",
      awarder: a.awarder ? orgId(a.awarder) : undefined,
      date: isoPartial(a.date),
      summary: a.summary,
    })),
    publications: (resume.publications ?? []).map((p) => ({
      ...base("pub", p.name),
      title: p.name ?? "Untitled publication",
      kind: "article",
      publisher: p.publisher ? orgId(p.publisher) : undefined,
      date: isoPartial(p.releaseDate),
      url: web(p.url),
      summary: p.summary,
    })),
    projects: (resume.projects ?? []).map((p) => ({
      ...base("project", p.name),
      name: p.name ?? "Untitled project",
      role: p.roles?.join(", "),
      organization: p.entity ? orgId(p.entity) : undefined,
      ...range(p),
      summary: p.description,
      highlights: p.highlights,
      url: web(p.url),
    })),
    skills: (resume.skills ?? []).map((s) => ({
      ...base("skill", s.name),
      name: s.name ?? "Unnamed skill",
      level: pick(LEVEL, s.level),
      keywords: s.keywords,
    })),
    languages: (resume.languages ?? []).filter((l) => l.language).map((l) => ({
      ...base("lang", l.language),
      language: guessTag(l.language),
      name: l.language,
      fluency: pick(FLUENCY, l.fluency),
    })),
    interests: (resume.interests ?? []).map((i) => ({ ...base("interest", i.name), name: i.name ?? "Interest", keywords: i.keywords })),
    references: (resume.references ?? []).map((r) => ({
      ...base("ref", r.name), visibility: "private", name: r.name ?? "Unnamed", quote: r.reference,
    })),
    sources: {
      import: { title: options.sourceTitle ?? "Imported resume.json", kind: "import", defaultQuality: "selfReported" },
    },
  };
  return strip(profile);
}

const TAGS = { english: "en", spanish: "es", french: "fr", german: "de", portuguese: "pt", italian: "it", dutch: "nl", japanese: "ja", chinese: "zh", mandarin: "zh", korean: "ko", arabic: "ar", russian: "ru", hindi: "hi" };
function guessTag(name) {
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(name)) return name;
  return TAGS[name.toLowerCase().trim()] ?? "und";
}

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined || x === "" || (Array.isArray(x) && x.length === 0)) continue;
      const s = strip(x);
      if (s && typeof s === "object" && !Array.isArray(s) && Object.keys(s).length === 0) continue;
      o[k] = s;
    }
    return o;
  }
  return v;
}
