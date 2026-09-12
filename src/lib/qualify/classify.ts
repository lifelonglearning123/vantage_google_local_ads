import { askForJson } from "@/lib/openai";
import {
  LOST_REASONS,
  OUTCOMES,
  type Classification,
  type Confidence,
  type LostReason,
  type Outcome,
} from "./outcomes";

export type ClassifyInput = {
  businessName: string;
  services: string[];
  transcript: string | null;
  summary: string | null;
  /** Signal's own lead-screening label for the call, when screening is on. A hint only. */
  screeningOutcome: string | null;
};

/** What the model returns, before `settleVerdict` applies the guards. */
export type ModelVerdict = {
  outcome: Outcome;
  lost_reason: LostReason | null;
  service_requested: string | null;
  matched_service: string | null;
  caller_name: string | null;
  confidence: Confidence;
  reasoning: string;
};

const MAX_TRANSCRIPT_CHARS = 16_000;

/**
 * Sort one call into Qualified, Qualification Required or Lost.
 *
 * A call with nothing from the caller (a hang-up, silence) is decided by rule.
 * Everything else goes to the model, then through `settleVerdict`, which only
 * ever moves a verdict towards Qualification Required — the stage a person
 * looks at — never away from it.
 */
export async function classifyCall(input: ClassifyInput): Promise<Classification> {
  if (nothingFromCaller(input)) {
    return {
      outcome: "qualification_required",
      lostReason: null,
      serviceRequested: null,
      matchedService: null,
      callerName: null,
      confidence: "high",
      reasoning: "Nothing to go on: the caller hung up or didn't say anything.",
      decidedBy: "rule",
    };
  }
  const { data, model } = await askForJson<ModelVerdict>({
    name: "call_verdict",
    instructions: buildInstructions(input),
    input: buildInput(input),
    schema: VERDICT_SCHEMA,
  });
  return settleVerdict(data, input.services, model);
}

/**
 * True only when we can see the caller gave us nothing: no transcript and no
 * summary, or a speaker-labelled transcript without a single caller line.
 */
export function nothingFromCaller(input: Pick<ClassifyInput, "transcript" | "summary">): boolean {
  const transcript = input.transcript?.trim();
  if (!transcript) return !input.summary?.trim();
  let labelled = false;
  for (const line of transcript.split(/\r?\n/)) {
    const caller = /^\s*(user|caller|customer|human)\s*:\s*(.*)$/i.exec(line);
    if (caller) {
      if (caller[2].trim()) return false;
      labelled = true;
    } else if (/^\s*(agent|assistant|ai|bot)\s*:/i.test(line)) {
      labelled = true;
    }
  }
  return labelled;
}

export function settleVerdict(
  v: ModelVerdict,
  services: string[],
  decidedBy: string,
): Classification {
  let outcome = v.outcome;
  let lostReason = outcome === "lost" ? v.lost_reason : null;
  const matchedService =
    outcome === "qualified" && v.matched_service ? findService(v.matched_service, services) : null;
  const notes: string[] = [];

  if (outcome === "lost" && (!lostReason || v.confidence === "low")) {
    outcome = "qualification_required";
    lostReason = null;
    notes.push("Might not be a customer, but it isn't clear enough to mark as lost.");
  }
  if (outcome === "qualified" && !matchedService) {
    outcome = "qualification_required";
    notes.push("What they asked for couldn't be matched to the services list.");
  }

  return {
    outcome,
    lostReason,
    // Someone selling to the business didn't request a service; the lost reason says what they wanted.
    serviceRequested: outcome === "lost" ? null : clean(v.service_requested),
    matchedService: outcome === "qualified" ? matchedService : null,
    callerName: clean(v.caller_name),
    confidence: v.confidence,
    reasoning: [...notes, v.reasoning.trim()].filter(Boolean).join(" "),
    decidedBy,
  };
}

/**
 * The model is told to copy the list entry word for word. Forgive case,
 * punctuation and a word either side ("Boiler repairs" vs "boiler repair"),
 * nothing looser — a qualified verdict must point at something on the list.
 */
export function findService(value: string, services: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = norm(value);
  if (!wanted) return null;
  return (
    services.find((s) => norm(s) === wanted) ??
    services.find((s) => {
      const n = norm(s);
      return n.length >= 3 && (n.includes(wanted) || wanted.includes(n));
    }) ??
    null
  );
}

export function buildInstructions(input: ClassifyInput): string {
  const services = input.services.map((s) => s.trim()).filter(Boolean);
  return [
    "You sort phone calls to a trades business into its sales pipeline.",
    "",
    `Business: ${input.businessName}`,
    "Services this business supplies:",
    services.length ? services.map((s) => `- ${s}`).join("\n") : "- (none listed)",
    "",
    "Choose exactly one outcome for the caller.",
    "",
    '"lost": the caller is not a potential customer. Set lost_reason to one of:',
    "- job_seeker: asking about jobs, vacancies, apprenticeships, or work for the business",
    '- sales_pitch: selling or offering something to the business (marketing, SEO, advertising, leads, software, insurance, finance, energy, supplies, a "quick question about your business")',
    "- accounts_query: wanting the accounts department (invoices, payments, statements, credit control, supplier admin) rather than asking for work to be done",
    "- spam: a robocall, recorded message or scam",
    "- wrong_number: clearly meant to reach someone else",
    "",
    '"qualified": the caller wants work done and it matches one of the services listed above. Match on meaning, not exact wording ("my boiler\'s leaking" matches "Boiler repairs"). Copy the matching entry from the list, word for word, into matched_service.',
    "",
    '"qualification_required": everything else. For example: they want a service that isn\'t on the list or is only loosely related, it\'s unclear what they want, the call was cut short, or there isn\'t enough to decide.',
    "",
    "Rules:",
    "- Judge what the caller wants. The agent's lines are only context.",
    '- Only choose "lost" when it is clear. If in doubt, choose "qualification_required": missing a real customer costs more than one call back.',
    '- If no services are listed, never choose "qualified".',
    "- lost_reason is null unless the outcome is lost. matched_service is null unless the outcome is qualified.",
    '- service_requested: the work they want done as a short label of 2 to 5 words ("Leaking boiler", "Bathroom refit"). null if they don\'t want work done.',
    "- caller_name: the caller's name if they gave it, otherwise null.",
    "- reasoning: one or two plain sentences a tradesperson would understand.",
    "- confidence: how sure you are of the outcome.",
    ...(input.screeningOutcome
      ? [
          "",
          `The phone agent's own screening labelled this call "${input.screeningOutcome}". It can be wrong, so treat it as a hint only.`,
        ]
      : []),
  ].join("\n");
}

function buildInput(input: ClassifyInput): string {
  const parts: string[] = [];
  if (input.summary?.trim()) parts.push(`Call summary:\n${input.summary.trim()}`);
  parts.push(`Transcript:\n${clip(input.transcript?.trim() || "(no transcript)")}`);
  return parts.join("\n\n");
}

/** Keep the opening and the end of a very long call; the middle decides least. */
function clip(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const half = MAX_TRANSCRIPT_CHARS / 2;
  return `${text.slice(0, half)}\n[… middle of the call left out …]\n${text.slice(-half)}`;
}

function clean(s: string | null): string | null {
  const t = s?.trim();
  return t && !["null", "n/a", "na", "unknown"].includes(t.toLowerCase()) ? t : null;
}

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "lost_reason",
    "service_requested",
    "matched_service",
    "caller_name",
    "confidence",
    "reasoning",
  ],
  properties: {
    outcome: { type: "string", enum: [...OUTCOMES] },
    lost_reason: { anyOf: [{ type: "string", enum: [...LOST_REASONS] }, { type: "null" }] },
    service_requested: { type: ["string", "null"] },
    matched_service: { type: ["string", "null"] },
    caller_name: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasoning: { type: "string" },
  },
};
