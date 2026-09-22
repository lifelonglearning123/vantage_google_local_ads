"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { agencyOf } from "@/lib/agencies";
import { deleteClient, readClient, saveClient, type ClientSettings } from "@/lib/clients";
import { decryptSecret } from "@/lib/crypto";
import { getLocation, listPipelines, type Pipeline } from "@/lib/ghl";
import { parsePhoneList } from "@/lib/phone";
import type { SettingsField } from "@/lib/qualify/config";
import { draftServicesFromWebsite, websiteAddress, WebsiteReadError } from "@/lib/qualify/draft-services";
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
export type DraftResult =
  | { ok: true; services: string[]; host: string }
  /** `website` is the address that was tried, for the page to offer back to correct; "" when there was none. */
  | { ok: false; message: string; website: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The client an action may change. Nothing the page sends is trusted: the
 * agency needs its own session and gets only its own clients, and a client
 * only ever gets their own sub-account. Also re-checks the client is still connected.
 */
async function allowedClient(target: SettingsTarget): Promise<ClientSettings> {
  const asAgency = target?.viewer === "agency";
  const locationId = typeof target?.locationId === "string" ? target.locationId : "";
  const agency = asAgency ? await requireAgency() : null;
  if (!agency && (!locationId || (await getSignedInLocation()) !== locationId)) redirect("/");
  const client = await readClient(locationId);
  if (!client || (agency && agencyOf(client)?.id !== agency.id)) redirect(agency ? "/agency" : "/");
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

/**
 * A suggested services list from the business's website. Fills the form only; nothing is saved.
 *
 * The address is the one typed on the page, when the page sends one (it offers
 * the field once the profile's address couldn't be read). Otherwise it's the
 * Nexus Portal business profile's, read live so a corrected profile counts
 * straight away, falling back to the copy saved when the client connected.
 */
export async function draftServicesAction(target: SettingsTarget, typed?: unknown): Promise<DraftResult> {
  const client = await allowedClient(target);
  const website = (typeof typed === "string" ? typed.trim() : "") || ((await profileWebsite(client)) ?? "");
  const fail = (message: string, detail?: string): DraftResult => {
    console.warn("[draft-services] no suggestion", { locationId: client.locationId, website, detail: detail ?? message });
    return { ok: false, message, website };
  };
  if (!website) {
    return fail("The Nexus Portal business profile has no website. Enter the address, or type the services in.");
  }
  const address = websiteAddress(website);
  if (!address.ok) return fail(address.message);

  try {
    const services = await draftServicesFromWebsite(client.businessName ?? "this business", address);
    return services.length
      ? { ok: true, services, host: address.host }
      : fail(`Couldn't find a list of services on ${address.host}. Try the page that lists them, or type the services in.`);
  } catch (e) {
    if (e instanceof WebsiteReadError) {
      return fail(`Couldn't read ${e.host}: ${e.reason}. Correct the address, or type the services in.`);
    }
    return fail("Vantage AI couldn't suggest services just now. Try again, or type the services in.", errorText(e));
  }
}

/** The website in the Nexus Portal business profile now, else the one saved when the client connected. */
async function profileWebsite(client: ClientSettings): Promise<string | null> {
  try {
    const live = await getLocation(decryptSecret(client.tokenEnc), client.locationId);
    return live.website?.trim() || client.website;
  } catch {
    return client.website;
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
