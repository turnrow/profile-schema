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
  },
  es: {
    between: "entre {a} y {b}", present: "Actualidad", circa: "c. {d}", before: "antes de {d}", after: "después de {d}", since: "desde {d}",
    nowAlso: "{then} (hoy {now})", dba: "{legal} (operando como {then})", continued: "Continúa: ",
    acquiredBy: "Adquirida por {x} ({d})", acquired: "Adquirió {x} ({d})", mergedInto: "Fusionada en {x} ({d})",
    independent: "Se independizó ({d})", spunOff: "Escindió {x} ({d})", splitInto: "Dividida en {x} ({d})",
    renamed: "Renombrada {x} ({d})", and: " y ",
  },
  fr: {
    between: "entre {a} et {b}", present: "Aujourd’hui", circa: "v. {d}", before: "avant {d}", after: "après {d}", since: "depuis {d}",
    nowAlso: "{then} (aujourd’hui {now})", dba: "{legal} (exerçant sous le nom {then})", continued: "Suite : ",
    acquiredBy: "Rachetée par {x} ({d})", acquired: "A racheté {x} ({d})", mergedInto: "Fusionnée dans {x} ({d})",
    independent: "Devenue indépendante ({d})", spunOff: "A scindé {x} ({d})", splitInto: "Scindée en {x} ({d})",
    renamed: "Renommée {x} ({d})", and: " et ",
  },
  de: {
    between: "zwischen {a} und {b}", present: "heute", circa: "ca. {d}", before: "vor {d}", after: "nach {d}", since: "seit {d}",
    nowAlso: "{then} (heute {now})", dba: "{legal} (firmiert als {then})", continued: "Fortgeführt: ",
    acquiredBy: "Übernommen von {x} ({d})", acquired: "Übernahm {x} ({d})", mergedInto: "Fusioniert zu {x} ({d})",
    independent: "Eigenständig geworden ({d})", spunOff: "Ausgegliedert: {x} ({d})", splitInto: "Aufgeteilt in {x} ({d})",
    renamed: "Umbenannt in {x} ({d})", and: " und ",
  },
  pt: {
    between: "entre {a} e {b}", present: "Atual", circa: "c. {d}", before: "antes de {d}", after: "depois de {d}", since: "desde {d}",
    nowAlso: "{then} (hoje {now})", dba: "{legal} (operando como {then})", continued: "Continuação: ",
    acquiredBy: "Adquirida pela {x} ({d})", acquired: "Adquiriu {x} ({d})", mergedInto: "Incorporada à {x} ({d})",
    independent: "Tornou-se independente ({d})", spunOff: "Cindiu {x} ({d})", splitInto: "Dividida em {x} ({d})",
    renamed: "Renomeada {x} ({d})", and: " e ",
  },
};

export const SUPPORTED_MESSAGE_LANGUAGES = Object.keys(MESSAGES);

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

export function number(locale, n) {
  try { return n.toLocaleString(locale); } catch { return String(n); }
}
