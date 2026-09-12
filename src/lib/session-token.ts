import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The two sign-ins, each a signed value with an expiry:
 *
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 *
 * A client's session names the sub-account they proved is theirs by connecting
 * with its location ID and a working token: {"l": locationId, "e": expiresAtMs}.
 * It never holds the token, which stays encrypted in the client's settings file.
 *
 * The agency's session is {"a": username, "e": expiresAtMs}, signed with a key
 * made from the session secret AND the agency's username and password. So
 * changing AGENCY_PASSWORD signs the agency out everywhere, and neither kind of
 * session can pass for the other.
 */

export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export type AgencyLogin = { username: string; password: string };

const mac = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

const agencyKey = (secret: string, login: AgencyLogin) =>
  createHmac("sha256", secret).update(`agency\n${login.username}\n${login.password}`).digest("base64url");

function sign(data: Record<string, unknown>, key: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${mac(payload, key)}`;
}

/** The payload of an unexpired value signed with `key`, otherwise null. */
function open(value: string | undefined, key: string, now: number): Record<string, unknown> | null {
  if (!value || !key) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload, key));
  const got = Buffer.from(signature);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof data.e === "number" && data.e > now ? data : null;
  } catch {
    return null;
  }
}

export function encodeSession(locationId: string, secret: string, now = Date.now()): string {
  return sign({ l: locationId, e: now + SESSION_MAX_AGE_SEC * 1000 }, secret);
}

/** The location ID from a valid, unexpired client session, otherwise null. */
export function decodeSession(value: string | undefined, secret: string, now = Date.now()): string | null {
  const data = open(value, secret, now);
  return typeof data?.l === "string" ? data.l : null;
}

export function encodeAgencySession(login: AgencyLogin, secret: string, now = Date.now()): string {
  return sign({ a: login.username, e: now + SESSION_MAX_AGE_SEC * 1000 }, agencyKey(secret, login));
}

/** Whether a value is a valid, unexpired agency session for this username and password. */
export function isAgencySession(
  value: string | undefined,
  login: AgencyLogin,
  secret: string,
  now = Date.now(),
): boolean {
  if (!secret) return false;
  return open(value, agencyKey(secret, login), now)?.a === login.username;
}

/** Whether a typed username and password are the agency's, without giving away how much of either was right. */
export function loginMatches(login: AgencyLogin, username: string, password: string): boolean {
  const digest = (text: string) => createHash("sha256").update(text).digest();
  const sameUsername = timingSafeEqual(digest(username), digest(login.username));
  const samePassword = timingSafeEqual(digest(password), digest(login.password));
  return sameUsername && samePassword;
}
