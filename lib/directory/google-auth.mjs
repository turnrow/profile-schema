// Google Workspace: an access token from a service account key, and the custom schema the
// connector keeps a person's extra fields in.
//
// Sources (read 2026-11-11):
//  - "Using OAuth 2.0 for Server to Server Applications"
//    (https://developers.google.com/identity/protocols/oauth2/service-account): a JWT with header
//    {alg: RS256, typ: JWT} and claims iss, scope, aud "https://oauth2.googleapis.com/token", iat,
//    exp (an hour at most) and, for domain-wide delegation, sub (the administrator to act as);
//    POSTed as grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>.
//  - schemas.insert: POST https://admin.googleapis.com/admin/directory/v1/customer/{customerId}/schemas,
//    scope https://www.googleapis.com/auth/admin.directory.userschema.
//
// The key file is read by the caller and passed in. Nothing here writes the key, the assertion or
// the token anywhere; the token lives only as long as the command that asked for it.

import { createSign } from "node:crypto";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE_USER = "https://www.googleapis.com/auth/admin.directory.user";
export const SCOPE_SCHEMA = "https://www.googleapis.com/auth/admin.directory.userschema";
const b64url = (x) => Buffer.from(x).toString("base64url");

/** The signed JWT a service account presents for a token. */
export function serviceAccountAssertion(key, { subject, scopes, now = Date.now() }) {
  if (key?.type !== "service_account" || !key.client_email || !key.private_key) throw new Error("the key file is not a Google service account key (it needs type, client_email and private_key)");
  if (!/^\S+@\S+\.\S+$/.test(subject ?? "")) throw new Error("name the administrator the service account acts as (an e-mail address): domain-wide delegation needs one");
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...(key.private_key_id ? { kid: key.private_key_id } : {}) }));
  // Ten minutes is enough for one run; Google allows an hour at most.
  const claims = b64url(JSON.stringify({ iss: key.client_email, sub: subject, scope: scopes.join(" "), aud: TOKEN_URL, iat, exp: iat + 600 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key.private_key).toString("base64url");
  return `${head}.${claims}.${signature}`;
}

/**
 * Exchange a service account key for a short-lived access token.
 * @param {object} args
 * @param {object} args.key  the parsed key file
 * @param {string} args.subject  the administrator to act as
 * @param {string[]} args.scopes
 * @param {Function} args.fetch
 * @returns {Promise<string>} the access token
 */
export async function googleAccessToken({ key, subject, scopes, fetch, now }) {
  const assertion = serviceAccountAssertion(key, { subject, scopes, now });
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
  let body = {};
  try { body = await res.json(); } catch { /* reported below */ }
  if (!res.ok || !body.access_token) {
    // Google's answer names the problem (unauthorized_client: the delegation is not set up); the assertion is never echoed.
    throw new Error(`Google did not give a token (${res.status}${body.error ? `: ${body.error}${body.error_description ? `, ${body.error_description}` : ""}` : ""}). Check that the service account has domain-wide delegation for ${scopes.join(" and ")}`);
  }
  return body.access_token;
}

/** The custom schema, as schemas.insert takes it: text fields only the user and administrators can read. */
export const TURNROW_SCHEMA = {
  schemaName: "TurnrowProfile",
  displayName: "Turnrow Profile",
  fields: ["pronouns", "nickname", "preferredTitle", "headline", "shortBio", "photoSha256"].map((fieldName) => ({
    fieldName, fieldType: "STRING", multiValued: false,
    displayName: { pronouns: "Pronouns", nickname: "Nickname", preferredTitle: "Preferred title", headline: "Headline", shortBio: "Short bio", photoSha256: "Photo hash (set by sync)" }[fieldName],
    // The hash is bookkeeping; the rest are what a person chose to show colleagues.
    readAccessType: fieldName === "photoSha256" ? "ADMINS_AND_SELF" : "ALL_DOMAIN_USERS",
  })),
};

/** The request that creates the schema. customerId: the account's id, or Google's "my_customer" alias. */
export function schemaRequest(customerId = "my_customer") {
  if (!/^[A-Za-z0-9_]+$/.test(customerId)) throw new Error(`"${customerId}" is not a Google customer id`);
  return { method: "POST", url: `https://admin.googleapis.com/admin/directory/v1/customer/${customerId}/schemas`, body: TURNROW_SCHEMA };
}
