"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { deleteClient, readClient, saveClient, type ClientSettings } from "@/lib/clients";
import { decryptSecret } from "@/lib/crypto";
import { getLocation, listPipelines, type Pipeline } from "@/lib/ghl";
import { parsePhoneList } from "@/lib/phone";
import type { SettingsField } from "@/lib/qualify/config";
import { draftServicesFromWebsite } from "@/lib/qualify/draft-services";
import { parseServices } from "@/lib/qualify/services";
import { STAGE_KINDS } from "@/lib/qualify/stages";
import { endSession, getSignedInLocation, requireAgency } from "@/lib/session";

export type Viewer = "client" | "agency";
/** Whose settings a form changes, and who's changing them. The page sends it, so every action checks it. */
export type SettingsTarget = { viewer: Viewer; locationId: string };
export type SaveState = {
  ok: boolean;
  message: string;
  /** Where the problem is, so the message can sit next to it. */
  field?: SettingsField;
  /** What was stored, tidied (numbers in E.164, services de-duplicated), so the form can show it. */
  saved?: { numbers: string[]; services: string[] };
} | null;
export type DraftResult = { ok: true; services: string[] } | { ok: false; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The client an action may change. Nothing the page sends is trusted: the
 * agency needs its own session to touch any client, and a client only ever
 * gets their own sub-account. Also re-checks the client is still connected.
 */
async function allowedClient(target: SettingsTarget): Promise<ClientSettings> {
  const agency = target?.viewer === "agency";
  const locationId = typeof target?.locationId === "string" ? target.locationId : "";
  if (agency) await requireAgency();
  else if (!locationId || (await getSignedInLocation()) !== locationId) redirect("/");
  const client = await readClient(locationId);
  if (!client) redirect(agency ? "/agency" : "/");
  return client;
}

export async function saveSettingsAction(target: SettingsTarget, formData: FormData): Promise<SaveState> {
  const client = await allowedClient(target);
  // One line per save in the server log: if the page ever reports a failed save with no
  // line here, the request never reached this code (a stale page, not a bug in the save).
  console.log("[settings] save", { locationId: client.locationId, by: target.viewer });
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const fail = (message: string, where?: SettingsField): SaveState => ({ ok: false, message, field: where });

  const { numbers, invalid } = parsePhoneList(field("numbers"));
  if (invalid.length) return fail(`These don't look like full phone numbers: ${invalid.join(", ")}.`, "numbers");
  if (numbers.length === 0) return fail("Add the Signal number whose calls should be sorted.", "numbers");

  let pipelines: Pipeline[];
  try {
    pipelines = await listPipelines(decryptSecret(client.tokenEnc), client.locationId);
  } catch (e) {
    return fail(errorText(e));
  }
  const pipeline = pipelines.find((p) => p.id === field("pipelineId"));
  if (!pipeline) return fail("Choose a pipeline.", "pipeline");

  const chosen = Object.fromEntries(STAGE_KINDS.map((kind) => [kind, field(`stage_${kind}`)])) as Record<
    (typeof STAGE_KINDS)[number],
    string
  >;
  const inPipeline = (id: string) => pipeline.stages.some((s) => s.id === id);
  const core = [chosen.newLeads, chosen.qualified, chosen.qualificationRequired];
  if (!core.every(inPipeline)) return fail("Choose a stage for each kind of call.", "stages");
  if (new Set(core).size < core.length) {
    return fail("Each kind of call needs its own stage. Two of them are set to the same one.", "stages");
  }
  if (chosen.lost && (!inPipeline(chosen.lost) || core.includes(chosen.lost))) {
    return fail("Lost calls need a stage of their own, or leave them where they are.", "stages");
  }

  const services = parseServices(field("services")).slice(0, 100);
  await saveClient({
    ...client,
    numbers,
    pipelineId: pipeline.id,
    stages: { ...chosen, lost: chosen.lost || null },
    services,
    callBacks: formData.get("callBacks") === "on",
    // Empty = let Signal choose. Anything else is a voice id it served us.
    callBackVoiceId: String(formData.get("callBackVoiceId") ?? "").trim().slice(0, 200) || null,
    updatedAt: new Date().toISOString(),
  });
  refresh();
  return {
    ok: true,
    message: services.length ? "Saved." : "Saved. Add the services so callers can be Qualified.",
    saved: { numbers, services },
  };
}

/** A suggested services list from the business's website. Fills the form only; nothing is saved. */
export async function draftServicesAction(target: SettingsTarget): Promise<DraftResult> {
  const client = await allowedClient(target);
  try {
    const website =
      client.website ?? (await getLocation(decryptSecret(client.tokenEnc), client.locationId)).website;
    if (!website) {
      return { ok: false, message: "The Nexus Portal business profile has no website to read. Type the services in instead." };
    }
    const services = await draftServicesFromWebsite(client.businessName ?? "this business", website);
    return services.length
      ? { ok: true, services }
      : { ok: false, message: "Couldn't find a list of services on the website. Type them in instead." };
  } catch (e) {
    return { ok: false, message: `Couldn't read the website (${errorText(e)}). Type the services in instead.` };
  }
}

export async function disconnectAction(target: SettingsTarget, _prev: SaveState, formData: FormData): Promise<SaveState> {
  const client = await allowedClient(target);
  if (formData.get("confirm") !== "on") return { ok: false, message: "Tick the box to confirm." };
  await deleteClient(client.locationId);
  if (target.viewer === "agency") redirect("/agency");
  await endSession();
  redirect("/");
}
