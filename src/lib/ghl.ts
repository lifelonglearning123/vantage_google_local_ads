import { ghlApiBase } from "@/lib/env";
import { REQUIRED_SCOPES } from "@/lib/ghl-scopes";

/**
 * The slice of the GoHighLevel API this app uses, authenticated with a client's
 * sub-account Private Integration token that has REQUIRED_SCOPES.
 */

const API_VERSION = "2021-07-28";

export { REQUIRED_SCOPES };

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "GhlError";
  }
}

export type PipelineStage = { id: string; name: string };
export type Pipeline = { id: string; name: string; stages: PipelineStage[] };
export type Note = { id: string; body: string };
export type LocationInfo = { name: string | null; website: string | null };

export type Opportunity = {
  id: string;
  name: string;
  status: string;
  pipelineId: string;
  pipelineStageId: string;
  contactId?: string;
  updatedAt?: string;
};

async function request<T>(
  token: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ghlApiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: API_VERSION,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GhlError(
      `Couldn't reach Nexus Portal: ${e instanceof Error ? e.message : String(e)}`,
      0,
      "",
    );
  }
  const text = await res.text();
  if (!res.ok) throw new GhlError(describeFailure(method, path, res.status, text), res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

function describeFailure(method: string, path: string, status: number, body: string): string {
  const endpoint = `${method} ${path.split("?")[0]}`;
  const detail = messageFrom(body);
  if (status === 401 || status === 403) {
    return (
      `Nexus Portal refused the token${detail ? ` (${detail})` : ""}. ` +
      `Check it was made in this sub-account and has these permissions: ${REQUIRED_SCOPES.join(", ")}.`
    );
  }
  return `Nexus Portal ${endpoint} failed (${status})${detail ? `: ${detail}` : ""}`;
}

function messageFrom(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: unknown; error?: unknown };
    const m = Array.isArray(json.message) ? json.message.join("; ") : (json.message ?? json.error);
    return typeof m === "string" ? m : "";
  } catch {
    return body.slice(0, 200);
  }
}

export async function getLocation(token: string, locationId: string): Promise<LocationInfo> {
  const data = await request<{
    location?: {
      name?: string | null;
      website?: string | null;
      business?: { name?: string | null; website?: string | null } | null;
    };
  }>(token, "GET", `/locations/${encodeURIComponent(locationId)}`);
  const l = data.location ?? {};
  return {
    name: l.name || l.business?.name || null,
    website: l.website || l.business?.website || null,
  };
}

export async function listPipelines(token: string, locationId: string): Promise<Pipeline[]> {
  const data = await request<{
    pipelines?: Array<{
      id: string;
      name: string;
      stages?: Array<{ id: string; name: string; position?: number }>;
    }>;
  }>(token, "GET", `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`);
  return (data.pipelines ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: [...(p.stages ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s) => ({ id: s.id, name: s.name })),
  }));
}

/** A one-contact search: proves the token can read this sub-account's contacts. */
export async function probeContactsAccess(token: string, locationId: string): Promise<void> {
  await request(token, "POST", "/contacts/search", { locationId, page: 1, pageLimit: 1 });
}

/** The contact's open opportunities in one pipeline, most recently updated first. */
export async function findOpenOpportunities(
  token: string,
  where: { locationId: string; contactId: string; pipelineId: string },
): Promise<Opportunity[]> {
  const query = new URLSearchParams({
    location_id: where.locationId,
    contact_id: where.contactId,
    pipeline_id: where.pipelineId,
    status: "open",
    limit: "20",
  });
  const data = await request<{ opportunities?: Opportunity[] }>(
    token,
    "GET",
    `/opportunities/search?${query}`,
  );
  // Filter again locally: a search filter silently ignored upstream must not
  // hand us somebody else's deal.
  return (data.opportunities ?? [])
    .filter(
      (o) =>
        o.status === "open" &&
        o.pipelineId === where.pipelineId &&
        (!o.contactId || o.contactId === where.contactId),
    )
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export async function createOpportunity(
  token: string,
  input: {
    locationId: string;
    pipelineId: string;
    pipelineStageId: string;
    contactId: string;
    name: string;
    source: string;
  },
): Promise<Opportunity> {
  const data = await request<{ opportunity?: Partial<Opportunity> }>(token, "POST", "/opportunities/", {
    ...input,
    status: "open",
  });
  const created = data.opportunity;
  if (!created?.id) {
    throw new GhlError("Nexus Portal didn't return the new opportunity.", 200, JSON.stringify(data));
  }
  // Everything after this keys off the stage, so fill in what we sent if the response leaves it out.
  return {
    id: created.id,
    name: created.name ?? input.name,
    status: created.status ?? "open",
    pipelineId: created.pipelineId ?? input.pipelineId,
    pipelineStageId: created.pipelineStageId ?? input.pipelineStageId,
    contactId: created.contactId ?? input.contactId,
  };
}

export function isDuplicateOpportunityError(e: unknown): boolean {
  return e instanceof GhlError && e.status === 400 && /duplicate/i.test(e.body);
}

export async function updateOpportunity(
  token: string,
  id: string,
  patch: {
    pipelineId: string;
    pipelineStageId?: string;
    status?: "open" | "lost";
    name?: string;
  },
): Promise<void> {
  await request(token, "PUT", `/opportunities/${encodeURIComponent(id)}`, patch);
}

export async function listContactNotes(token: string, contactId: string): Promise<Note[]> {
  const data = await request<{ notes?: Array<{ id: string; body?: string | null }> }>(
    token,
    "GET",
    `/contacts/${encodeURIComponent(contactId)}/notes`,
  );
  return (data.notes ?? []).map((n) => ({ id: n.id, body: n.body ?? "" }));
}

export async function addContactNote(token: string, contactId: string, body: string): Promise<void> {
  await request(token, "POST", `/contacts/${encodeURIComponent(contactId)}/notes`, { body });
}

/** Only for events that arrive without a contact id (hand-made test events). */
export async function findOrCreateContact(
  token: string,
  input: { locationId: string; phone: string; name: string | null },
): Promise<string> {
  const found = await request<{ contacts?: Array<{ id: string }> }>(token, "POST", "/contacts/search", {
    locationId: input.locationId,
    page: 1,
    pageLimit: 1,
    filters: [{ field: "phone", operator: "eq", value: input.phone }],
  });
  if (found.contacts?.[0]?.id) return found.contacts[0].id;

  const created = await request<{ contact?: { id: string } }>(token, "POST", "/contacts/", {
    locationId: input.locationId,
    phone: input.phone,
    ...(input.name ? { firstName: input.name } : {}),
  });
  if (!created.contact?.id) {
    throw new GhlError("Nexus Portal didn't return the new contact.", 200, JSON.stringify(created));
  }
  return created.contact.id;
}
