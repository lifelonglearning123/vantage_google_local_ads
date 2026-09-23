export const OUTCOMES = ["qualified", "qualification_required", "lost"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const LOST_REASONS = [
  "job_seeker",
  "sales_pitch",
  "accounts_query",
  "spam",
  "wrong_number",
  "not_offered",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export type Confidence = "high" | "medium" | "low";

export const OUTCOME_LABELS: Record<Outcome, string> = {
  qualified: "Qualified",
  qualification_required: "Qualification Required",
  lost: "Lost",
};

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  job_seeker: "Job seeker",
  sales_pitch: "Sales pitch",
  accounts_query: "Accounts query",
  spam: "Spam",
  wrong_number: "Wrong number",
  not_offered: "Not a job we do",
};

export type Classification = {
  outcome: Outcome;
  lostReason: LostReason | null;
  serviceRequested: string | null;
  /** The services-list entry it matched, verbatim. Only set when qualified. */
  matchedService: string | null;
  callerName: string | null;
  confidence: Confidence;
  reasoning: string;
  /** The model that decided, or "rule" when no model was needed. */
  decidedBy: string;
};
