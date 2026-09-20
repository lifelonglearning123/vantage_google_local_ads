import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { agencyForHost, signInProblem, type Agency } from "@/lib/agencies";
import {
  SESSION_MAX_AGE_SEC,
  decodeSession,
  encodeAgencySession,
  encodeSession,
  isAgencySession,
} from "@/lib/session-token";

const CLIENT_COOKIE = "lq_client";
const AGENCY_COOKIE = "lq_agency";

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SEC,
});

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters).");
  return secret;
}

/** The sub-account the visitor has connected, or null. Pages and actions check the settings file still exists too. */
export async function getSignedInLocation(): Promise<string | null> {
  return decodeSession((await cookies()).get(CLIENT_COOKIE)?.value, process.env.SESSION_SECRET ?? "");
}

export async function startSession(locationId: string): Promise<void> {
  (await cookies()).set(CLIENT_COOKIE, encodeSession(locationId, sessionSecret()), cookieOptions());
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(CLIENT_COOKIE);
}

/** The agency this request's domain belongs to (src/lib/agencies.ts), or null. */
export async function agencyForRequest(): Promise<Agency | null> {
  return agencyForHost((await headers()).get("host"));
}

/** The agency whose domain this is, if someone can sign in as it here; otherwise why not. */
export async function agencySignIn(): Promise<{ ok: true; agency: Agency } | { ok: false; reason: string }> {
  const agency = await agencyForRequest();
  const problem = signInProblem(agency);
  return problem || !agency?.login ? { ok: false, reason: problem ?? "" } : { ok: true, agency };
}

/** The agency signed in on this domain, or null. A session made on another agency's domain never counts. */
export async function signedInAgency(): Promise<Agency | null> {
  const agency = await agencyForRequest();
  if (!agency?.login) return null;
  const cookie = (await cookies()).get(AGENCY_COOKIE)?.value;
  return isAgencySession(cookie, agency.id, agency.login, process.env.SESSION_SECRET ?? "") ? agency : null;
}

/** For agency pages and actions: anyone without an agency session goes to the agency sign-in. */
export async function requireAgency(): Promise<Agency> {
  const agency = await signedInAgency();
  if (!agency) redirect("/agency/sign-in");
  return agency;
}

export async function startAgencySession(agency: Agency): Promise<void> {
  if (!agency.login) throw new Error("This agency has no sign-in.");
  (await cookies()).set(AGENCY_COOKIE, encodeAgencySession(agency.id, agency.login, sessionSecret()), cookieOptions());
}

export async function endAgencySession(): Promise<void> {
  (await cookies()).delete(AGENCY_COOKIE);
}
