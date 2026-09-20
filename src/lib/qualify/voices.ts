import {
  callBackVoicesBody,
  callBackVoicesSchema,
  SIGNATURE_HEADER,
  signPayload,
  type CallBackVoice,
} from "@/lib/signal/contract";

/**
 * The voices a client can choose from for their call-backs.
 *
 * This app holds no telephony credentials — on purpose — so it can't read the
 * voice list itself. Signal serves it for the sub-account, signed with the
 * same secret as everything else, and the client picks one on the settings
 * page. The chosen id rides back to Signal with each call-back request.
 */

export type VoiceList = {
  /** The Signal workspace this app is wired to, as Signal names it. */
  agency: { slug: string; name: string } | null;
  voices: CallBackVoice[];
  /** Voices the client's own AI receptionist uses — a call-back must not sound like those. */
  receptionistVoiceIds: string[];
  /** What Signal picks when the client chooses nothing. */
  automatic: string | null;
};

const TIMEOUT_MS = 8_000;

/** Signal's address, for the pages (the webhook payload carries it for calls). */
function signalBase(): string | null {
  const raw = process.env.SIGNAL_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) {
      return u.toString().replace(/\/+$/, "");
    }
  } catch {
    // Falls through to null: the settings page then offers "Choose for me" only.
  }
  return null;
}

/**
 * Never throws: a Signal that can't be reached leaves the client with the
 * automatic voice, which is what they'd have had anyway.
 */
export async function listCallBackVoices(locationId: string): Promise<VoiceList | null> {
  const base = signalBase();
  const secret = process.env.SIGNAL_WEBHOOK_SECRET;
  if (!base || !secret) return null;
  const body = callBackVoicesBody(locationId);
  const t = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(`${base}/api/call-backs/voices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Vantage-Lead-Qualifier/1",
        [SIGNATURE_HEADER]: signPayload(secret, body, t),
      },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[voices] Signal wouldn't list them", { locationId, status: res.status });
      return null;
    }
    const parsed = callBackVoicesSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || !parsed.data.ok) return null;
    return {
      agency: parsed.data.agency ?? null,
      voices: parsed.data.voices ?? [],
      receptionistVoiceIds: parsed.data.receptionistVoiceIds ?? [],
      automatic: parsed.data.automatic ?? null,
    };
  } catch (e) {
    console.warn("[voices] couldn't reach Signal", {
      locationId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** How a voice reads in the picker: "Adrian · male · British". */
export function voiceLabel(voice: CallBackVoice): string {
  return [voice.name || voice.id, voice.gender, voice.accent].filter(Boolean).join(" · ");
}

/**
 * The order they're offered in: the ones a call-back can actually use first,
 * male voices before the rest, and the receptionist's own voices last — a
 * call-back in that voice is the one thing this setting exists to avoid.
 */
export function sortVoices(list: VoiceList): CallBackVoice[] {
  const used = new Set(list.receptionistVoiceIds);
  const rank = (v: CallBackVoice) =>
    (used.has(v.id) ? 4 : 0) + (v.gender?.toLowerCase() === "male" ? 0 : 1);
  return [...list.voices].sort(
    (a, b) => rank(a) - rank(b) || (a.name || a.id).localeCompare(b.name || b.id),
  );
}
