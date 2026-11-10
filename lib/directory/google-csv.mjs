// Google Workspace, by file: the Admin console's "Bulk update users" CSV (Directory > Users).
//
// Source for the format: Google's help page "Add or update multiple users from a CSV file"
// (https://knowledge.workspace.google.com/admin/users/add-or-update-multiple-users-from-a-csv-file,
// last updated 2026-10-26, read 2026-11-10). What it settles:
//  - every row needs First Name, Last Name, Email Address, Password and Org Unit Path;
//  - a row whose Email Address is an existing user's updates that user;
//  - "****" in Password keeps the user's password;
//  - an optional column left empty does not remove what the directory holds;
//  - a file with non-ASCII text is saved as UTF-8 with a byte-order mark.
// The page names the required columns and a few optional ones. The other optional columns used
// here (Work Phone, Employee ID, Employee Title, Department, Cost Center) are spelled as the
// console's own template and export spell them; they are not listed on the help page, so headers
// are matched without regard to case or a trailing [note], and only read, except Work Phone.

export const id = "google-csv";
export const label = "Google Workspace (bulk update CSV)";

const REQUIRED = ["First Name [Required]", "Last Name [Required]", "Email Address [Required]", "Password [Required]", "Org Unit Path [Required]"];

/** Neutral field → the CSV column that holds it. */
export const fields = {
  givenName: "First Name [Required]",
  familyName: "Last Name [Required]",
  phone: "Work Phone",
  title: "Employee Title",
  department: "Department",
  costCenter: "Cost Center",
  employeeNumber: "Employee ID",
};
// Columns a sync may write. The rest are the employer's, and are only ever read.
export const writable = ["givenName", "familyName", "phone"];
const WRITABLE = writable;

/** Rows of a CSV file (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes). */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, i = 0, any = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === "") { quoted = true; any = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; any = true; i++; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      if (any || cell !== "" || row.length) { row.push(cell); rows.push(row); }
      row = []; cell = ""; any = false; i++; continue;
    }
    cell += c; i++;
  }
  if (quoted) throw new Error("a quoted field is never closed");
  if (any || cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const key = (header) => String(header).replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const quote = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * The console's export of users ("Download users").
 * @returns {object[]} directory users in neutral fields; `keep` holds what an update row must repeat
 */
export function readExport(bytes) {
  const rows = parseCsv(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes);
  if (!rows.length) throw new Error("the export is empty");
  const header = rows[0].map(key);
  const col = (name) => header.indexOf(key(name));
  for (const need of ["Email Address [Required]", "First Name [Required]", "Last Name [Required]", "Org Unit Path [Required]"]) {
    if (col(need) < 0) throw new Error(`the export has no "${need}" column; download it from the Admin console (Directory > Users > Download users)`);
  }
  const get = (r, name) => { const i = col(name); const v = i < 0 ? undefined : r[i]?.trim(); return v === "" ? undefined : v; };
  const seen = new Set();
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r, n) => {
    const email = get(r, "Email Address [Required]");
    if (!email) throw new Error(`row ${n + 2} of the export has no e-mail address`);
    if (seen.has(email.toLowerCase())) throw new Error(`${email} is in the export twice`);
    seen.add(email.toLowerCase());
    return {
      id: email.toLowerCase(),
      primaryEmail: email,
      emails: [email, get(r, "Work Secondary Email"), get(r, "Home Secondary Email")].filter(Boolean),
      employeeNumber: get(r, "Employee ID"),
      givenName: get(r, "First Name [Required]"), familyName: get(r, "Last Name [Required]"),
      phone: get(r, "Work Phone"), title: get(r, "Employee Title"), department: get(r, "Department"), costCenter: get(r, "Cost Center"),
      keep: { givenName: get(r, "First Name [Required]"), familyName: get(r, "Last Name [Required]"), orgUnitPath: get(r, "Org Unit Path [Required]") },
    };
  });
}

/**
 * The file to upload: one row per user with changes. Each row repeats what Google requires (the
 * names, the organizational unit, "****" for the password) and fills only the columns that change.
 */
export function render(changeSet) {
  const changed = changeSet.changes.map((c) => ({ ...c, fields: c.fields.filter((f) => WRITABLE.includes(f.field)) })).filter((c) => c.fields.length);
  const optional = WRITABLE.filter((f) => !["givenName", "familyName"].includes(f) && changed.some((c) => c.fields.some((x) => x.field === f))).map((f) => fields[f]);
  const header = [...REQUIRED, ...optional];
  const lines = [header];
  for (const c of changed) {
    const to = Object.fromEntries(c.fields.map((f) => [f.field, f.to]));
    const first = to.givenName ?? c.user.keep?.givenName, last = to.familyName ?? c.user.keep?.familyName, ou = c.user.keep?.orgUnitPath;
    if (!first || !last || !ou) throw new Error(`${c.user.primaryEmail}: Google needs the first name, last name and organizational unit on every row, and the export does not give them`);
    for (const v of [first, last]) {
      // A name that a spreadsheet would run as a formula is not a name.
      if (/^[=@\t\r]/.test(v) || /[\u0000-\u001f]/.test(v)) throw new Error(`${c.user.primaryEmail}: "${v}" is not written to a file an administrator may open in a spreadsheet`);
      if (v.length > 60) throw new Error(`${c.user.primaryEmail}: "${v}" is longer than the 60 characters Google allows for a name`);
    }
    lines.push([first, last, c.user.primaryEmail, "****", ou, ...optional.map((col) => to[WRITABLE.find((f) => fields[f] === col)] ?? "")]);
  }
  const body = lines.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
  // Google asks for a byte-order mark when the file holds anything beyond ASCII.
  const data = /[^\u0000-\u007f]/.test(body) ? `﻿${body}` : body;
  return [{ name: "google-bulk-update.csv", data, how: "upload google-bulk-update.csv in the Admin console: Directory > Users > Bulk update users" }];
}
