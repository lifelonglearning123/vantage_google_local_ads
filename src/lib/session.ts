import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_MAX_AGE_SEC,
  decodeSession,
  encodeAgencySession,
  encodeSession,
  isAgencySession,
  type AgencyLogin,
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

/** The agency's username and password (AGENCY_USERNAME, AGENCY_PASSWORD), or why agency sign-in is off. */
export function agencyLogin(): { ok: true; login: AgencyLogin } | { ok: false; reason: string } {
  const username = process.env.AGENCY_USERNAME?.trim() ?? "";
  const password = process.env.AGENCY_PASSWORD ?? "";
  if (!username || !password) {
    return {
      ok: false,
      reason: "Agency sign-in isn't set up yet. Add AGENCY_USERNAME and AGENCY_PASSWORD to the app's environment.",
    };
  }
  if (password.length < 12) return { ok: false, reason: "AGENCY_PASSWORD needs to be at least 12 characters." };
  return { ok: true, login: { username, password } };
}

export async function isAgencySignedIn(): Promise<boolean> {
  const setup = agencyLogin();
  if (!setup.ok) return false;
  return isAgencySession((await cookies()).get(AGENCY_COOKIE)?.value, setup.login, process.env.SESSION_SECRET ?? "");
}

/** For agency pages and actions: anyone without an agency session goes to the agency sign-in. */
export async function requireAgency(): Promise<void> {
  if (!(await isAgencySignedIn())) redirect("/agency/sign-in");
}

export async function startAgencySession(login: AgencyLogin): Promise<void> {
  (await cookies()).set(AGENCY_COOKIE, encodeAgencySession(login, sessionSecret()), cookieOptions());
}

export async function endAgencySession(): Promise<void> {
  (await cookies()).delete(AGENCY_COOKIE);
}
