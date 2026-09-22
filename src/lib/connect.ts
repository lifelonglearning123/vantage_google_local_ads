import { agencyOf } from "@/lib/agencies";
import { readClient, saveClient, type ClientSettings } from "@/lib/clients";
import { encryptSecret } from "@/lib/crypto";
import { getLocation, listPipelines, probeContactsAccess } from "@/lib/ghl";

// `locationId` comes back so the form can refill it: React resets a form after its action runs.
export type ConnectState = { error: string; locationId: string } | null;

export type ConnectResult = { ok: true; settings: ClientSettings } | { ok: false; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Connects a sub-account, for a client signing in or the agency adding one. A
 * token that lists the location's pipelines and contacts proves the
 * sub-account is theirs. The token is saved encrypted so calls can be sorted
 * while nobody's on the page; connecting again with a new token replaces it
 * and keeps the settings.
 *
 * A new file belongs to the agency whose domain it was connected on, for
 * good. A client may sign in on any domain; an agency can't take over a
 * sub-account that already belongs to another one.
 */
export async function connectClient(
  locationId: string,
  token: string,
  agencyId: string,
  by: "client" | "agency",
): Promise<ConnectResult> {
  if (!/^[A-Za-z0-9]{1,64}$/.test(locationId)) {
    return {
      ok: false,
      error: "That location ID doesn't look right. It's the letters and numbers after /location/ in the sub-account's web address.",
    };
  }
  if (token.length < 10) return { ok: false, error: "Paste the whole Private Integration token." };

  const [location, pipelines, contacts] = await Promise.allSettled([
    getLocation(token, locationId),
    listPipelines(token, locationId),
    probeContactsAccess(token, locationId),
  ]);
  const refused = [pipelines, contacts].find((r) => r.status === "rejected");
  if (refused) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // slows down guessing
    return { ok: false, error: errorText(refused.reason) };
  }

  const info = location.status === "fulfilled" ? location.value : null;
  const now = new Date().toISOString();
  const existing = await readClient(locationId);
  if (existing && by === "agency" && agencyOf(existing)?.id !== agencyId) {
    return { ok: false, error: "This sub-account is already connected under another agency." };
  }
  const settings: ClientSettings = existing
    ? {
        ...existing,
        tokenEnc: encryptSecret(token),
        businessName: info?.name ?? existing.businessName,
        website: info?.website ?? existing.website,
        updatedAt: now,
      }
    : {
        version: 1,
        locationId,
        businessName: info?.name ?? null,
        website: info?.website ?? null,
        tokenEnc: encryptSecret(token),
        numbers: [],
        pipelineId: null,
        stages: { newLeads: null, qualified: null, qualificationRequired: null, lost: null },
        services: [],
        agency: agencyId,
        connectedAt: now,
        updatedAt: now,
      };
  await saveClient(settings);
  return { ok: true, settings };
}
