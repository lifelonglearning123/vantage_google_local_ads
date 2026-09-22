import { z } from "zod";
import { verifySignature } from "@/lib/signal/contract";
import type { AgencyLogin } from "@/lib/session-token";

/**
 * The agencies this one deployment serves, told apart by domain. Each has its
 * own sign-in, its own Signal workspace (so its own webhook secret) and its
 * own clients. Nothing is stored for an agency but this list, read from the
 * environment on every call, never at import time:
 *
 *   AGENCIES='[{"id":"vantage","name":"Vantage","host":"vantage.example.com",
 *               "username":"…","password":"…","signalWebhookSecret":"…"}, …]'
 *
 * Without AGENCIES, the older single-agency variables (AGENCY_USERNAME,
 * AGENCY_PASSWORD, SIGNAL_WEBHOOK_SECRET) make one agency that answers on
 * every host — which is what localhost and the test scripts use.
 *
 * A client's settings file names its agency by id (`agency`). A file that
 * names none — every file saved before agencies were told apart — belongs to
 * the FIRST agency in the list, so put the original agency first.
 */

export type Agency = {
  /** Short and stable: it's written into each client's settings file. */
  id: string;
  /** Shown in the band on the agency's pages. */
  name: string;
  /** The domain the agency signs in at, or "*" for any. */
  host: string;
  /** Null only for the older single-agency setup with no username and password: calls are sorted, nobody signs in. */
  login: AgencyLogin | null;
  /** The secret their Signal workspace signs calls with, and this app signs call-backs with. */
  signalWebhookSecret: string;
};

export type AgencySetup = { ok: true; agencies: Agency[] } | { ok: false; reason: string };

const HOST = /^(\*|[a-z0-9.-]+)$/;

const agencySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/, "id: lower-case letters, digits and dashes only"),
  name: z.string().trim().min(1).max(60).optional(),
  host: z.string().trim().toLowerCase().regex(HOST, "host: a domain name, or *"),
  username: z.string().trim().min(1),
  password: z.string().min(12, "password: at least 12 characters"),
  signalWebhookSecret: z.string().min(16, "signalWebhookSecret: at least 16 characters"),
});

/** The list, or why agency sign-in and the webhook are off. */
export function agencySetup(): AgencySetup {
  const raw = process.env.AGENCIES?.trim();
  if (!raw) return legacySetup();

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "AGENCIES isn't valid JSON. It should be a list of agencies in square brackets." };
  }
  const parsed = z.array(agencySchema).min(1).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? `agency ${String(Number(issue.path[0]) + 1)}, ${issue.path.slice(1).join(".")}` : "the list";
    return { ok: false, reason: `AGENCIES: ${where}: ${issue.message}` };
  }
  const agencies = parsed.data.map<Agency>((a) => ({
    id: a.id,
    name: a.name ?? a.id,
    host: hostname(a.host),
    login: { username: a.username, password: a.password },
    signalWebhookSecret: a.signalWebhookSecret,
  }));
  for (const key of ["id", "host"] as const) {
    const seen = new Set<string>();
    for (const a of agencies) {
      if (seen.has(a[key])) return { ok: false, reason: `AGENCIES: two agencies have the same ${key} "${a[key]}".` };
      seen.add(a[key]);
    }
  }
  return { ok: true, agencies };
}

function legacySetup(): AgencySetup {
  const username = process.env.AGENCY_USERNAME?.trim() ?? "";
  const password = process.env.AGENCY_PASSWORD ?? "";
  const secret = process.env.SIGNAL_WEBHOOK_SECRET ?? "";
  if (!username && !password && !secret) {
    return { ok: false, reason: "Agency sign-in isn't set up yet. Add AGENCIES to the app's environment (see .env.example)." };
  }
  if ((username || password) && password.length < 12) {
    return { ok: false, reason: "AGENCY_PASSWORD needs to be at least 12 characters." };
  }
  const login = username && password ? { username, password } : null;
  return { ok: true, agencies: [{ id: "default", name: "Agency", host: "*", login, signalWebhookSecret: secret }] };
}

/** Why nobody can sign in as this agency, or null when they can. */
export function signInProblem(agency: Agency | null): string | null {
  if (!agency) return "This address isn't set up for an agency. Sign in at the address your agency uses.";
  if (!agency.login) return "Agency sign-in isn't set up yet. Add AGENCY_USERNAME and AGENCY_PASSWORD, or AGENCIES, to the app's environment.";
  return null;
}

/** The agencies, or none when the setup is wrong (the pages show why). */
export function agencies(): Agency[] {
  const setup = agencySetup();
  return setup.ok ? setup.agencies : [];
}

/** "Vantage.Example.com:3000" → "vantage.example.com". */
function hostname(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** The agency signed in at this host: an exact match, else one that answers on any host. */
export function agencyForHost(host: string | null | undefined, list: Agency[] = agencies()): Agency | null {
  const h = host ? hostname(host) : "";
  return list.find((a) => a.host === h) ?? list.find((a) => a.host === "*") ?? null;
}

/**
 * The agency a client's file belongs to: the one it names, else the first in
 * the list. Null only when no agency is set up at all.
 */
export function agencyOf(client: { agency?: string | null }, list: Agency[] = agencies()): Agency | null {
  return list.find((a) => a.id === client.agency) ?? list[0] ?? null;
}

/**
 * Which agency's Signal workspace signed a request. The signature is the
 * proof, not the host it arrived on: a workspace holds exactly one secret.
 */
export function agencyBySignature(
  rawBody: string,
  header: string | null,
  list: Agency[] = agencies(),
): { ok: true; agency: Agency } | { ok: false; reason: string } {
  let reason = "no agency is set up";
  for (const agency of list) {
    if (!agency.signalWebhookSecret) continue;
    const check = verifySignature(rawBody, header, agency.signalWebhookSecret);
    if (check.ok) return { ok: true, agency };
    reason = check.reason;
  }
  return { ok: false, reason: reason === "signature does not match" ? "signature does not match any agency's secret" : reason };
}
