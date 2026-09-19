import {
  callBackAnswerSchema,
  callBackRequestBody,
  SIGNATURE_HEADER,
  signPayload,
  type CallBackReason,
  type CallSyncedEvent,
} from "@/lib/signal/contract";
import type { Classification } from "./outcomes";

/**
 * Call-backs: a caller who hung up, or whose call left it unclear what they
 * wanted, is rung back by the client's AI receptionist a few minutes later.
 * This app only decides that a call deserves one and asks Signal; Signal owns
 * the when, the number, the re-checks and the call itself (its AGENTS.md,
 * "Call-backs"). The result of the call-back comes back as an ordinary
 * `call.synced` with `callBackOf` set, and is sorted like any other call.
 */

export type CallBackAsk =
  | { ask: true; reason: CallBackReason }
  /** `why` is for the contact's note; null when nothing needs saying. */
  | { ask: false; why: string | null };

export function callBackDecision(input: {
  /** The client turned call-backs on in settings. */
  enabled: boolean;
  event: CallSyncedEvent;
  verdict: Classification | null;
  /** False when the call couldn't be sorted: nothing is asked for then. */
  sorted: boolean;
  /** Where the opportunity is after this call. */
  finalStageId: string;
  qualificationRequiredStageId: string | null;
}): CallBackAsk {
  const { event, verdict } = input;
  if (!input.enabled || !input.sorted) return { ask: false, why: null };
  // Only callers who rang in. A call-back's own result never asks for another.
  if (event.call.direction !== "inbound" || event.call.callBackOf) return { ask: false, why: null };
  if (verdict?.outcome !== "qualification_required") return { ask: false, why: null };
  if (!input.qualificationRequiredStageId || input.finalStageId !== input.qualificationRequiredStageId) {
    return { ask: false, why: "The opportunity is already further along, so the team has it." };
  }
  if (!event.call.fromNumber) return { ask: false, why: "The caller's number was withheld." };
  if (!event.callBackUrl) return { ask: false, why: "The AI on this line can't ring callers back." };
  return { ask: true, reason: verdict.decidedBy === "rule" ? "hang_up" : "unclear" };
}

export type CallBackResult =
  /** Signal will ring, or is ringing. */
  | { kind: "scheduled"; dueAt: Date | null; timezone: string | null }
  /** Asked before, and already rung. */
  | { kind: "rung" }
  /** Signal won't ring, or closed an earlier request without ringing. */
  | { kind: "refused"; reason: string }
  /** The request didn't get an answer. */
  | { kind: "failed"; reason: string };

const REQUEST_TIMEOUT_MS = 10_000;

/** https, or plain http to this machine for local checks. */
function allowedUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return u;
    if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return u;
    return null;
  } catch {
    return null;
  }
}

/** Ask Signal to ring the caller back. Never throws. */
export async function requestCallBack(
  url: string,
  secret: string,
  callId: string,
  reason: CallBackReason,
  /** The client's chosen call-back voice, or null to let Signal choose. */
  voiceId: string | null = null,
): Promise<CallBackResult> {
  const target = allowedUrl(url);
  if (!target) return { kind: "failed", reason: "Signal sent an address that isn't https" };
  const body = callBackRequestBody(callId, reason, voiceId);
  const t = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Vantage-Lead-Qualifier/1",
        [SIGNATURE_HEADER]: signPayload(secret, body, t),
      },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = callBackAnswerSchema.safeParse(await res.json().catch(() => null));
    const answer = parsed.success ? parsed.data : null;
    if (res.status === 422 && answer?.reason) return { kind: "refused", reason: answer.reason };
    if (!res.ok || !answer?.ok) {
      return { kind: "failed", reason: answer?.error ?? `Signal answered ${res.status}` };
    }
    if (answer.status === "dialled") return { kind: "rung" };
    if (answer.status === "skipped" || answer.status === "expired" || answer.status === "failed") {
      return { kind: "refused", reason: answer.note ?? "An earlier call-back for this call was closed." };
    }
    const due = answer.dueAt ? new Date(answer.dueAt) : null;
    return {
      kind: "scheduled",
      dueAt: due && !Number.isNaN(due.getTime()) ? due : null,
      timezone: answer.timezone ?? null,
    };
  } catch (e) {
    return { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** "in about 5 minutes", "at 09:00 tomorrow", "at 09:00 on Monday". */
export function callBackWhen(dueAt: Date | null, now: Date, timezone: string | null): string {
  if (!dueAt) return "shortly";
  const minutes = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 1) return "in a minute or two";
  if (minutes <= 75) return `in about ${minutes} minutes`;
  const zone = timezone ?? "UTC";
  try {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(dueAt);
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" }).format(d);
    if (day(dueAt) === day(now)) return `at ${time}`;
    if (day(dueAt) === day(new Date(now.getTime() + 86_400_000))) return `at ${time} tomorrow`;
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long" }).format(dueAt);
    return `at ${time} on ${weekday}`;
  } catch {
    return `at ${dueAt.toISOString().slice(11, 16)} UTC`;
  }
}

/** The contact note's call-back line. */
export function callBackNoteLine(result: CallBackResult, now: Date): string {
  switch (result.kind) {
    case "scheduled":
      return `Call-back: the AI receptionist will ring them back ${callBackWhen(result.dueAt, now, result.timezone)}.`;
    case "rung":
      return "Call-back: the AI receptionist has already rung them back.";
    case "refused":
      return `Call-back: not made. ${result.reason}`;
    case "failed":
      return `Call-back: couldn't ask Signal for one (${result.reason}). Ring them back yourselves.`;
  }
}
