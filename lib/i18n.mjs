// Words and date formats used in rendered output, by language. Dates and numbers use Intl,
// so any locale the runtime supports formats correctly; the phrases below fall back to English.
// To add a language, copy the "en" block and translate the values (keep the {placeholders}).

const MESSAGES = {
  en: {
    between: "between {a} and {b}", present: "Present", circa: "c. {d}", before: "before {d}", after: "after {d}", since: "{d} on",
    nowAlso: "{then} (now {now})", dba: "{legal} (doing business as {then})", continued: "Continued: ",
    acquiredBy: "Acquired by {x} ({d})", acquired: "Acquired {x} ({d})", mergedInto: "Merged into {x} ({d})",
    independent: "Became independent ({d})", spunOff: "Spun off {x} ({d})", splitInto: "Split into {x} ({d})",
    renamed: "Renamed {x} ({d})", and: " and ",
    titleAt: "{title} at {org}", aColleague: "A colleague",
    // Résumé view: section headings, the document title and levels.
    hSummary: "Summary", hExperience: "Experience", hEducation: "Education", hCredentials: "Licenses and certifications", hSkills: "Skills", hLanguages: "Languages",
    hAwards: "Awards", hProjects: "Projects", hPublications: "Publications", hService: "Service and volunteering", hRecommendations: "Recommendations", resumeTitle: "{name}: résumé", notCompleted: "{x} (not completed)",
    fluency_elementary: "Elementary", fluency_limitedWorking: "Limited working", fluency_professionalWorking: "Professional working", fluency_fullProfessional: "Full professional", fluency_native: "Native or bilingual", level_familiar: "Familiar", level_proficient: "Proficient", level_advanced: "Advanced", level_expert: "Expert",
  },
  es: {
    between: "entre {a} y {b}", present: "Actualidad", circa: "c. {d}", before: "antes de {d}", after: "después de {d}", since: "desde {d}",
    nowAlso: "{then} (hoy {now})", dba: "{legal} (operando como {then})", continued: "Continúa: ",
    acquiredBy: "Adquirida por {x} ({d})", acquired: "Adquirió {x} ({d})", mergedInto: "Fusionada en {x} ({d})",
    independent: "Se independizó ({d})", spunOff: "Escindió {x} ({d})", splitInto: "Dividida en {x} ({d})",
    renamed: "Renombrada {x} ({d})", and: " y ",
    titleAt: "{title} en {org}", aColleague: "Colega de trabajo",
    // Résumé view: section headings, the document title and levels.
    hSummary: "Resumen", hExperience: "Experiencia", hEducation: "Formación", hCredentials: "Licencias y certificaciones", hSkills: "Competencias", hLanguages: "Idiomas",
    hAwards: "Premios", hProjects: "Proyectos", hPublications: "Publicaciones", hService: "Servicio y voluntariado", hRecommendations: "Recomendaciones", resumeTitle: "{name}: currículum", notCompleted: "{x} (sin completar)",
    fluency_elementary: "Básico", fluency_limitedWorking: "Competencia básica limitada", fluency_professionalWorking: "Competencia profesional", fluency_fullProfessional: "Competencia profesional completa", fluency_native: "Nativo o bilingüe", level_familiar: "Conocimientos básicos", level_proficient: "Competente", level_advanced: "Avanzado", level_expert: "Experto",
  },
  fr: {
    between: "entre {a} et {b}", present: "Aujourd’hui", circa: "v. {d}", before: "avant {d}", after: "après {d}", since: "depuis {d}",
    nowAlso: "{then} (aujourd’hui {now})", dba: "{legal} (exerçant sous le nom {then})", continued: "Suite : ",
    acquiredBy: "Rachetée par {x} ({d})", acquired: "A racheté {x} ({d})", mergedInto: "Fusionnée dans {x} ({d})",
    independent: "Devenue indépendante ({d})", spunOff: "A scindé {x} ({d})", splitInto: "Scindée en {x} ({d})",
    renamed: "Renommée {x} ({d})", and: " et ",
    titleAt: "{title} chez {org}", aColleague: "Collègue",
    // Résumé view: section headings, the document title and levels.
    hSummary: "Résumé", hExperience: "Expérience", hEducation: "Formation", hCredentials: "Licences et certifications", hSkills: "Compétences", hLanguages: "Langues",
    hAwards: "Distinctions", hProjects: "Projets", hPublications: "Publications", hService: "Service et bénévolat", hRecommendations: "Recommandations", resumeTitle: "{name} : CV", notCompleted: "{x} (non terminé)",
    fluency_elementary: "Notions", fluency_limitedWorking: "Compétence professionnelle limitée", fluency_professionalWorking: "Compétence professionnelle", fluency_fullProfessional: "Compétence professionnelle complète", fluency_native: "Langue maternelle ou bilingue", level_familiar: "Notions", level_proficient: "Confirmé", level_advanced: "Avancé", level_expert: "Expert",
  },
  de: {
    between: "zwischen {a} und {b}", present: "heute", circa: "ca. {d}", before: "vor {d}", after: "nach {d}", since: "seit {d}",
    nowAlso: "{then} (heute {now})", dba: "{legal} (firmiert als {then})", continued: "Fortgeführt: ",
    acquiredBy: "Übernommen von {x} ({d})", acquired: "Übernahm {x} ({d})", mergedInto: "Fusioniert zu {x} ({d})",
    independent: "Eigenständig geworden ({d})", spunOff: "Ausgegliedert: {x} ({d})", splitInto: "Aufgeteilt in {x} ({d})",
    renamed: "Umbenannt in {x} ({d})", and: " und ",
    titleAt: "{title} bei {org}", aColleague: "Kollegin oder Kollege",
    // Résumé view: section headings, the document title and levels.
    hSummary: "Profil", hExperience: "Berufserfahrung", hEducation: "Ausbildung", hCredentials: "Lizenzen und Zertifikate", hSkills: "Kenntnisse", hLanguages: "Sprachen",
    hAwards: "Auszeichnungen", hProjects: "Projekte", hPublications: "Veröffentlichungen", hService: "Dienst und Ehrenamt", hRecommendations: "Empfehlungen", resumeTitle: "{name}: Lebenslauf", notCompleted: "{x} (nicht abgeschlossen)",
    fluency_elementary: "Grundkenntnisse", fluency_limitedWorking: "Gute Kenntnisse", fluency_professionalWorking: "Fließend", fluency_fullProfessional: "Verhandlungssicher", fluency_native: "Muttersprache oder zweisprachig", level_familiar: "Grundkenntnisse", level_proficient: "Gute Kenntnisse", level_advanced: "Fortgeschritten", level_expert: "Experte",
  },
  pt: {
    between: "entre {a} e {b}", present: "Atual", circa: "c. {d}", before: "antes de {d}", after: "depois de {d}", since: "desde {d}",
    nowAlso: "{then} (hoje {now})", dba: "{legal} (operando como {then})", continued: "Continuação: ",
    acquiredBy: "Adquirida pela {x} ({d})", acquired: "Adquiriu {x} ({d})", mergedInto: "Incorporada à {x} ({d})",
    independent: "Tornou-se independente ({d})", spunOff: "Cindiu {x} ({d})", splitInto: "Dividida em {x} ({d})",
    renamed: "Renomeada {x} ({d})", and: " e ",
    titleAt: "{title} na {org}", aColleague: "Colega de trabalho",
    // Résumé view: section headings, the document title and levels.
    hSummary: "Resumo", hExperience: "Experiência", hEducation: "Formação", hCredentials: "Licenças e certificações", hSkills: "Competências", hLanguages: "Idiomas",
    hAwards: "Prêmios", hProjects: "Projetos", hPublications: "Publicações", hService: "Serviço e voluntariado", hRecommendations: "Recomendações", resumeTitle: "{name}: currículo", notCompleted: "{x} (não concluído)",
    fluency_elementary: "Básico", fluency_limitedWorking: "Limitado para o trabalho", fluency_professionalWorking: "Profissional", fluency_fullProfessional: "Profissional pleno", fluency_native: "Nativo ou bilíngue", level_familiar: "Noções", level_proficient: "Proficiente", level_advanced: "Avançado", level_expert: "Especialista",
  },
};

export const SUPPORTED_MESSAGE_LANGUAGES = Object.keys(MESSAGES);
/** Every phrase key; each supported language must translate all of them (a test checks). */
export const MESSAGE_KEYS = Object.keys(MESSAGES.en);
/** Does this language have its own wording for the key (no fallback to English)? */
export const translates = (lang, key) => typeof MESSAGES[lang]?.[key] === "string";

/** A message in the requested locale (or its base language), falling back to English. */
export function t(locale, key, vars = {}) {
  const base = String(locale ?? "en").split("-")[0];
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[base]?.[key] ?? MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

/** "Mar 2024" in en-US, "mar 2024" in es, "März 2024" in de. Year-only dates stay as the year. */
export function monthYear(locale, partial) {
  const [y, m] = String(partial).split("-");
  if (!m) return y;
  try {
    return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(+y, +m - 1, 1)));
  } catch {
    return `${y}-${m}`;
  }
}

/** Is this message key translated (in the locale, its base language, or English)? */
export const hasMessage = (locale, key) => t(locale, key) !== key;

/** Text direction of a locale's script: "rtl" for Arabic, Hebrew, Persian, Urdu and the like. */
export function direction(locale) {
  try {
    const l = new Intl.Locale(locale).maximize();
    return ["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm"].includes(l.script) ? "rtl" : "ltr";
  } catch { return "ltr"; }
}

export function number(locale, n) {
  try { return n.toLocaleString(locale); } catch { return String(n); }
}
