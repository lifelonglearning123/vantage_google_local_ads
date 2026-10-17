import type { Outcome } from "./outcomes";

export type StageIds = {
  newLeads: string;
  qualificationRequired: string;
  qualified: string;
  /** Optional "Lost" stage. Lost calls always get the Lost status either way. */
  lost: string | null;
};

export type OpportunityPlan =
  | { action: "move"; stageId: string; status: "open" | "lost" }
  | { action: "leave"; reason: string };

/**
 * Where a call's verdict takes the contact's open opportunity.
 *
 * It only ever moves FORWARD through the stages this app owns
 * (New Leads → Qualification Required → Qualified). A brand-new opportunity
 * starts in New Leads, so it follows the same rule and goes wherever the
 * verdict says. For an existing one:
 *  - once a salesperson has moved it to any other stage it is theirs — leave it;
 *  - a weaker verdict never drags it back (a qualified lead who rings again
 *    and hangs up stays qualified);
 *  - "lost" only applies before it has been qualified — a qualified customer
 *    ringing about their invoice is not a lost deal.
 */
/**
 * A lead call: an outbound call that isn't one of Signal's call-backs. Signal
 * only sends calls an AI agent handled, so this is the AI ringing someone the
 * business wants to reach — most often a lead who has just enquired through
 * an ad or a form, rung within seconds by a workflow (J's Electrical's
 * Facebook leads from 10 October 2026, which sat in New Leads unsorted while
 * outbound calls were ignored).
 *
 * It is sorted only while that lead's opportunity is still untouched in New
 * Leads. One the team has moved on is theirs, and a contact with no open
 * opportunity in the pipeline is not a lead this app was asked to sort — a
 * lead call never creates one.
 */
export function leadCallPlan(
  open: { pipelineStageId: string } | undefined,
  newLeadsStageId: string,
): { sort: true } | { sort: false; reason: string } {
  if (!open) {
    return { sort: false, reason: "an outbound call only sorts an open opportunity that's already in the pipeline" };
  }
  if (open.pipelineStageId !== newLeadsStageId) {
    return { sort: false, reason: "the opportunity has already moved on from New Leads, so it's the team's" };
  }
  return { sort: true };
}

/**
 * On a lead call, a verdict decided by rule — they didn't pick up, it went to
 * voicemail, or they said nothing — means the lead wasn't reached. It stays in
 * New Leads rather than reading as "Contacted". Null when the call should be
 * planned as usual.
 */
export function leadCallLeaves(decidedBy: string): string | null {
  return decidedBy === "rule" ? "They weren't reached, so it stays in New Leads." : null;
}

export function planOpportunity(
  outcome: Outcome,
  currentStageId: string,
  stages: StageIds,
): OpportunityPlan {
  const rank = new Map<string, number>([
    [stages.newLeads, 0],
    [stages.qualificationRequired, 1],
    [stages.qualified, 2],
  ]);
  if (stages.lost && !rank.has(stages.lost)) rank.set(stages.lost, 0);

  const currentRank = rank.get(currentStageId);
  if (currentRank === undefined) {
    return { action: "leave", reason: "A salesperson has already moved it to another stage." };
  }
  if (outcome === "lost") {
    return currentRank >= 2
      ? { action: "leave", reason: "It's already qualified, so one call isn't enough to mark it lost." }
      : { action: "move", stageId: stages.lost ?? currentStageId, status: "lost" };
  }
  const targetRank = outcome === "qualified" ? 2 : 1;
  if (targetRank <= currentRank) {
    return {
      action: "leave",
      reason:
        targetRank === currentRank
          ? "It's already in that stage."
          : "It's already further along, so it wasn't moved back.",
    };
  }
  return {
    action: "move",
    stageId: outcome === "qualified" ? stages.qualified : stages.qualificationRequired,
    status: "open",
  };
}
