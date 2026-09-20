import { readClient } from "@/lib/clients";
import {
  addContactNote,
  createOpportunity,
  findOpenOpportunities,
  findOrCreateContact,
  isDuplicateOpportunityError,
  listContactNotes,
  updateOpportunity,
  type Opportunity,
} from "@/lib/ghl";
import type { CallSyncedEvent } from "@/lib/signal/contract";
import { callBackDecision, callBackNoteLine, requestCallBack } from "./call-back";
import { classifyCall } from "./classify";
import { callIsOnNumbers, loadLiveConfig, type LiveConfig } from "./config";
import { planOpportunity } from "./decide";
import { LOST_REASON_LABELS, OUTCOME_LABELS, type Classification, type Outcome } from "./outcomes";

/**
 * One Signal call in, one GoHighLevel opportunity sorted, using the settings
 * the client chose in the app (numbers, pipeline, stages, services). No call
 * or customer data is kept: the pipeline is GoHighLevel's, the call is Signal's.
 *
 * It runs in two halves so Signal isn't kept waiting:
 *  1. `acceptCall`, before responding: loads the client's settings, checks
 *     the number, finds the contact and makes sure the opportunity exists (a
 *     new one goes into New Leads). If this throws, the webhook answers 500
 *     and Signal sends the call again on its next sync.
 *  2. `finish`, after responding: the verdict, the stage move and a note on
 *     the contact. The note carries the call's reference, which is how a call
 *     Signal sends twice is recognised as already done.
 */

export type ProcessDeps = { classify?: typeof classifyCall };

export type FinishResult = {
  outcome: Outcome | null;
  action: "moved" | "left" | "not_qualified";
  stage: string;
  detail: string;
  /** The contact note's call-back line, when there is one to write. */
  callBack?: string | null;
};

export type AcceptResult =
  | { kind: "ignored" | "duplicate"; reason: string }
  | {
      kind: "accepted";
      opportunityId: string;
      created: boolean;
      finish: () => Promise<FinishResult>;
    };

const PLACEHOLDER_WHAT = "Phone enquiry";

// Two deliveries of the same call arriving together on one instance.
const inFlight = new Set<string>();

export const noteRef = (callId: string) => `Signal call ${callId}`;

export async function acceptCall(event: CallSyncedEvent, deps: ProcessDeps = {}): Promise<AcceptResult> {
  const { call } = event;
  // Outbound calls are the team's, except a call-back: Signal ringing a caller
  // back for this app, whose result is sorted like the call it returns.
  if (call.direction !== "inbound" && !call.callBackOf) {
    return { kind: "ignored", reason: "outbound calls are updated by the salesperson" };
  }
  const locationId = event.ghl?.locationId;
  if (!locationId) return { kind: "ignored", reason: "the call has no Nexus Portal sub-account" };

  if (inFlight.has(call.id)) return { kind: "duplicate", reason: "this call is already being handled" };
  inFlight.add(call.id);
  let handedOver = false;
  try {
    const settings = await readClient(locationId);
    if (!settings) return { kind: "ignored", reason: `sub-account ${locationId} isn't connected to the app` };
    if (!callIsOnNumbers(settings.numbers, call)) {
      return { kind: "ignored", reason: `${call.toNumber ?? "the number called"} isn't one of the numbers chosen for this sub-account` };
    }

    const config = await loadLiveConfig(settings);
    const { token } = config;
    const customerPhone = customerNumber(call);
    let contactId = event.ghl?.contactId ?? null;
    if (!contactId) {
      if (!customerPhone) throw new Error("No contact from Signal, and no caller number to find one by.");
      contactId = await findOrCreateContact(token, { locationId, phone: customerPhone, name: call.callerName ?? null });
    }
    const notes = await listContactNotes(token, contactId);
    if (notes.some((n) => n.body.includes(noteRef(call.id)))) {
      return { kind: "duplicate", reason: "this call has already been sorted" };
    }
    if (!config.pipeline || !config.stages.newLeads) {
      throw new Error(`Can't add the opportunity. ${config.problems.join(" ")}`);
    }

    const pipelineId = config.pipeline.id;
    const open = await findOpenOpportunities(token, { locationId, contactId, pipelineId });
    let opportunity = open[0];
    const created = !opportunity;
    if (!opportunity) {
      try {
        opportunity = await createOpportunity(token, {
          locationId,
          pipelineId,
          pipelineStageId: config.stages.newLeads,
          contactId,
          name: opportunityName(call.callerName ?? null, customerPhone, null),
          source: "Signal call",
        });
      } catch (e) {
        if (isDuplicateOpportunityError(e)) {
          throw new Error(
            'Nexus Portal won\'t add a second opportunity for this contact. Turn on "Allow duplicate opportunities" in the sub-account\'s opportunity settings.',
          );
        }
        throw e;
      }
    }

    handedOver = true;
    const ready: Ready = { event, contactId, config, opportunity };
    return {
      kind: "accepted",
      opportunityId: opportunity.id,
      created,
      finish: () => finishCall(ready, deps.classify ?? classifyCall).finally(() => inFlight.delete(call.id)),
    };
  } finally {
    if (!handedOver) inFlight.delete(call.id);
  }
}

type Ready = {
  event: CallSyncedEvent;
  contactId: string;
  config: LiveConfig;
  opportunity: Opportunity;
};

/** Never throws: whatever happens, the contact gets a note saying so. */
async function finishCall(
  { event, contactId, config, opportunity }: Ready,
  classify: typeof classifyCall,
): Promise<FinishResult> {
  const { call } = event;
  const { token, settings } = config;
  const stageName = (id: string) => config.pipeline?.stages.find((s) => s.id === id)?.name ?? "an unlisted stage";
  const { newLeads, qualificationRequired, qualified, lost } = config.stages;

  let verdict: Classification | null = null;
  let finalStageId = opportunity.pipelineStageId;
  let result: FinishResult;
  try {
    if (!newLeads || !qualificationRequired || !qualified) throw new Error(config.problems.join(" "));
    verdict = await classify({
      businessName: settings.businessName ?? event.client.name,
      services: settings.services,
      transcript: call.transcript ?? null,
      summary: call.summary ?? null,
      screeningOutcome: call.leadScreening?.outcome ?? null,
      endReason: call.endReason ?? null,
      callBack: !!call.callBackOf,
    });
    const plan = planOpportunity(verdict.outcome, opportunity.pipelineStageId, {
      newLeads,
      qualificationRequired,
      qualified,
      lost,
    });
    if (plan.action === "move") {
      // Rename only the placeholder a first call gave it; a name someone typed stays.
      const rename = opportunity.name.endsWith(`– ${PLACEHOLDER_WHAT}`);
      await updateOpportunity(token, opportunity.id, {
        pipelineId: opportunity.pipelineId,
        pipelineStageId: plan.stageId,
        status: plan.status,
        ...(rename ? { name: opportunityName(call.callerName ?? verdict.callerName, customerNumber(call), verdict) } : {}),
      });
      finalStageId = plan.stageId;
      result = { outcome: verdict.outcome, action: "moved", stage: stageName(plan.stageId), detail: "" };
    } else {
      result = {
        outcome: verdict.outcome,
        action: "left",
        stage: stageName(opportunity.pipelineStageId),
        detail: plan.reason,
      };
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error("[qualify] couldn't sort the call", { callId: call.id, error: why });
    result = {
      outcome: verdict?.outcome ?? null,
      action: "not_qualified",
      stage: stageName(opportunity.pipelineStageId),
      detail: why,
    };
  }

  result.callBack = await askForCallBack(
    event,
    { enabled: settings.callBacks === true, voiceId: settings.callBackVoiceId ?? null },
    verdict,
    result,
    finalStageId,
    qualificationRequired,
  );

  const warnings =
    settings.services.length === 0
      ? ["No services have been added in the app yet, so no caller can be Qualified."]
      : [];
  try {
    await addContactNote(token, contactId, buildNote(verdict, result, warnings, call.id, !!call.callBackOf));
  } catch (e) {
    console.error("[qualify] note not added", {
      callId: call.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return result;
}

/** The customer's number: who rang in, or who a call-back rang. */
function customerNumber(call: CallSyncedEvent["call"]): string | null {
  return (call.direction === "inbound" ? call.fromNumber : call.toNumber) ?? null;
}

/**
 * Asks Signal to ring the caller back when the client wants call-backs and
 * this call left the opportunity in Qualification Required. Returns the note's
 * call-back line, or null. Never throws.
 */
async function askForCallBack(
  event: CallSyncedEvent,
  callBacks: { enabled: boolean; voiceId: string | null },
  verdict: Classification | null,
  result: FinishResult,
  finalStageId: string,
  qualificationRequiredStageId: string | null,
): Promise<string | null> {
  const decision = callBackDecision({
    enabled: callBacks.enabled,
    event,
    verdict,
    sorted: result.action !== "not_qualified",
    finalStageId,
    qualificationRequiredStageId,
  });
  if (!decision.ask) return decision.why ? `Call-back: not made. ${decision.why}` : null;
  const secret = process.env.SIGNAL_WEBHOOK_SECRET;
  const outcome = secret
    ? await requestCallBack(event.callBackUrl ?? "", secret, event.call.id, decision.reason, callBacks.voiceId)
    : ({ kind: "failed", reason: "SIGNAL_WEBHOOK_SECRET is not set" } as const);
  if (outcome.kind === "failed") {
    console.error("[qualify] call-back not requested", { callId: event.call.id, error: outcome.reason });
  }
  return callBackNoteLine(outcome, new Date());
}

export function opportunityName(
  callerName: string | null,
  fromNumber: string | null,
  verdict: Classification | null,
): string {
  const who = callerName?.trim() || fromNumber || "Unknown caller";
  const what =
    verdict?.outcome === "lost" && verdict.lostReason
      ? LOST_REASON_LABELS[verdict.lostReason]
      : verdict?.serviceRequested?.trim() || PLACEHOLDER_WHAT;
  return `${who} – ${what}`;
}

export function buildNote(
  v: Classification | null,
  r: FinishResult,
  warnings: string[],
  callId: string,
  isCallBack = false,
): string {
  const lines: string[] = [];
  if (isCallBack) lines.push("The AI receptionist rang them back after their earlier call.");
  if (v) {
    lines.push(
      `Call qualification: ${OUTCOME_LABELS[v.outcome]}${v.lostReason ? ` (${LOST_REASON_LABELS[v.lostReason]})` : ""}`,
    );
    if (v.serviceRequested) {
      lines.push(`Wants: ${v.serviceRequested}${v.matchedService ? ` (matches "${v.matchedService}")` : ""}`);
    }
    lines.push(`Why: ${v.reasoning}`);
  } else {
    lines.push("Call qualification: not done");
  }
  if (r.action === "moved") {
    lines.push(`Opportunity: moved to ${r.stage}${v?.outcome === "lost" ? " and marked Lost" : ""}.`);
  } else if (r.action === "left") {
    lines.push(`Opportunity: left in ${r.stage}. ${r.detail}`);
  } else {
    lines.push(`Opportunity: left in ${r.stage}. It couldn't be sorted automatically: ${r.detail}`);
  }
  if (r.callBack) lines.push(r.callBack);
  lines.push(...warnings, "", `Ref: ${noteRef(callId)}`);
  return lines.join("\n");
}
