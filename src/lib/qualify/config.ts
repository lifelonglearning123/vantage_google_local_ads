import type { ClientSettings } from "@/lib/clients";
import { decryptSecret } from "@/lib/crypto";
import { GhlError, listPipelines, type Pipeline } from "@/lib/ghl";
import { normalizePhone } from "@/lib/phone";
import type { CallSyncedEvent } from "@/lib/signal/contract";
import { STAGE_LABELS, type StageChoice } from "./stages";

/**
 * A client's saved choices checked against their pipelines as they are in
 * GoHighLevel right now — a stage deleted there since the client chose it
 * shows up here as a problem rather than a failed write.
 */
export type LiveConfig = {
  settings: ClientSettings;
  token: string;
  pipeline: Pipeline | null;
  stages: StageChoice;
  /** What stops calls being sorted, in words the client can act on. Empty when live. */
  problems: string[];
};

export async function loadLiveConfig(settings: ClientSettings): Promise<LiveConfig> {
  const token = decryptSecret(settings.tokenEnc);
  const pipelines = await listPipelines(token, settings.locationId);
  return { settings, token, ...resolveConfig(settings, pipelines) };
}

/** The part of the settings page a problem is fixed in, so the page can link straight to it. */
export type SettingsField = "numbers" | "pipeline" | "stages" | "services";
export type SettingsIssue = { field: SettingsField; text: string };

export type ClientCheck = {
  pipelines: Pipeline[];
  pipeline: Pipeline | null;
  problems: string[];
  issues: SettingsIssue[];
  /** Why GoHighLevel couldn't be read, or null. */
  ghlError: string | null;
  /** GoHighLevel answered, and said no to the saved token. */
  tokenRefused: boolean;
};

/** For the pages: a client's settings checked against GoHighLevel now. Never throws. */
export async function checkClient(settings: ClientSettings): Promise<ClientCheck> {
  let pipelines: Pipeline[] = [];
  let ghlError: string | null = null;
  let tokenRefused = false;
  try {
    pipelines = await listPipelines(decryptSecret(settings.tokenEnc), settings.locationId);
  } catch (e) {
    ghlError = e instanceof Error ? e.message : String(e);
    tokenRefused = e instanceof GhlError && (e.status === 401 || e.status === 403);
  }
  return { pipelines, ghlError, tokenRefused, ...resolveConfig(settings, pipelines) };
}

export function resolveConfig(
  settings: Pick<ClientSettings, "numbers" | "pipelineId" | "stages" | "services">,
  pipelines: Pipeline[],
): { pipeline: Pipeline | null; stages: StageChoice; problems: string[]; issues: SettingsIssue[] } {
  const issues: SettingsIssue[] = [];
  const problem = (field: SettingsField, text: string) => issues.push({ field, text });
  if (settings.numbers.length === 0) problem("numbers", "Add the Signal number whose calls should be sorted.");

  const pipeline = settings.pipelineId ? (pipelines.find((p) => p.id === settings.pipelineId) ?? null) : null;
  if (!settings.pipelineId) problem("pipeline", "Choose your pipeline and stages.");
  else if (!pipeline) problem("pipeline", "The pipeline you chose no longer exists in Nexus Portal. Choose it again.");

  const stillThere = (id: string | null) => (id && pipeline?.stages.some((s) => s.id === id) ? id : null);
  const stages: StageChoice = {
    newLeads: stillThere(settings.stages.newLeads),
    qualified: stillThere(settings.stages.qualified),
    qualificationRequired: stillThere(settings.stages.qualificationRequired),
    // Optional: if it's gone, lost calls are still marked Lost where they are.
    lost: stillThere(settings.stages.lost),
  };
  if (pipeline) {
    for (const kind of ["newLeads", "qualified", "qualificationRequired"] as const) {
      if (!stages[kind]) problem("stages", `Choose the stage for ${STAGE_LABELS[kind]}.`);
    }
  }

  if (settings.services.length === 0) {
    problem("services", "Add the services you supply. Until then no caller can be Qualified.");
  }
  return { pipeline, stages, problems: issues.map((i) => i.text), issues };
}

/**
 * Whether a call is on one of the client's chosen numbers, however either side
 * writes it: the number rung for a call in, the number rung from for a
 * call-back going out.
 */
export function callIsOnNumbers(
  numbers: string[],
  call: Pick<CallSyncedEvent["call"], "direction" | "fromNumber" | "toNumber" | "agentPhoneNumber">,
): boolean {
  const line = call.direction === "outbound" ? call.fromNumber : call.toNumber;
  return [line, call.agentPhoneNumber]
    .map(normalizePhone)
    .some((n) => !!n && numbers.includes(n));
}
