import type { PipelineStage } from "@/lib/ghl";

/** The four stages a client maps in settings, in the order the form shows them. */
export const STAGE_KINDS = ["newLeads", "qualified", "qualificationRequired", "lost"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/** Stage ids chosen from the client's pipeline. Lost is optional. */
export type StageChoice = Record<StageKind, string | null>;

export const STAGE_LABELS: Record<StageKind, string> = {
  newLeads: "New Leads",
  qualified: "Qualified",
  qualificationRequired: "Qualification Required",
  lost: "Lost",
};

/** What sends a call to each stage, in the words the settings page uses. */
export const STAGE_WHEN: Record<StageKind, string> = {
  newLeads: "Every new call lands here first",
  qualified: "Wants a service you offer",
  qualificationRequired: "Not clear yet, or hung up",
  lost: "Job seeker, sales call, accounts, spam or wrong number",
};

/**
 * A stage name that reads like the opposite of what it was chosen for, such as
 * "Qualified Out" chosen for callers who want a service. Only a prompt to
 * double-check: pipelines name stages all sorts of ways.
 */
export function stageNameWarning(kind: StageKind, name: string): string | null {
  const n = name.toLowerCase();
  if (kind === "qualified" && /\b(out|lost|dead|closed|junk|spam|no|not|unqualified|disqualified)\b/.test(n)) {
    return `"${name}" sounds like a lead that's been ruled out. Is that where callers who want your services should go?`;
  }
  if (kind === "lost" && /\b(qualified in|won|booked|hot)\b/.test(n)) {
    return `"${name}" sounds like a good lead. Is that where job seekers and sales calls should go?`;
  }
  return null;
}

// Pre-selects stages by name, so a pipeline that already has the right stages needs no picking.
const NAME_GUESSES: Record<StageKind, RegExp[]> = {
  newLeads: [/^new\s*leads?$/i, /new\s*lead/i],
  qualified: [/^qualified$/i, /^qualified\b/i],
  qualificationRequired: [/qualification\s*required/i, /needs?\s*qualif/i, /to\s*qualify/i, /unqualified/i],
  lost: [/^lost$/i, /\blost\b/i],
};

export function guessStage(stages: PipelineStage[], kind: StageKind): string | null {
  for (const pattern of NAME_GUESSES[kind]) {
    const hit = stages.find((s) => pattern.test(s.name.trim()));
    if (hit) return hit.id;
  }
  return null;
}
