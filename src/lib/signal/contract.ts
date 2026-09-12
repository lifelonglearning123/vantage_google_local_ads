import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Signal's outbound webhook, contract v1 (Signal AGENTS.md, "Call webhook").
 *
 * Signal POSTs `call.synced` once a call has landed in the client's
 * GoHighLevel — so the contact already exists and its id is in the payload —
 * and `ping` from the "Send test event" button. Every request is signed:
 *
 *   X-Signal-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Delivery is at-least-once (a failed POST is retried on Signal's next sync
 * pass), so receivers dedupe on `call.id`.
 */

export const SIGNATURE_HEADER = "x-signal-signature";
export const SIGNATURE_TOLERANCE_SEC = 300;

export function signPayload(secret: string, rawBody: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing signature header" };

  let t: number | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t" && v && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && v) candidates.push(v);
  }
  if (t === null || candidates.length === 0) {
    return { ok: false, reason: "malformed signature header" };
  }
  // The timestamp is inside the signed string, so a captured request can't be
  // replayed later with a fresh one.
  if (Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SEC) {
    return { ok: false, reason: "signature timestamp is outside the 5-minute window" };
  }
  const expected = Buffer.from(signPayload(secret, rawBody, t).split("v1=")[1], "utf8");
  const matches = candidates.some((c) => {
    const got = Buffer.from(c, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return matches ? { ok: true } : { ok: false, reason: "signature does not match" };
}

const agency = z.object({ id: z.string(), slug: z.string(), name: z.string() });

const callSynced = z.object({
  event: z.literal("call.synced"),
  version: z.literal(1),
  deliveryId: z.string(),
  sentAt: z.string(),
  agency,
  client: z.object({ id: z.string(), name: z.string() }),
  call: z.object({
    id: z.string().min(1),
    platform: z.string(),
    platformCallId: z.string(),
    direction: z.enum(["inbound", "outbound"]),
    startedAt: z.string(),
    durationSec: z.number(),
    fromNumber: z.string().nullish(),
    toNumber: z.string().nullish(),
    agentPhoneNumber: z.string().nullish(),
    callerName: z.string().nullish(),
    summary: z.string().nullish(),
    transcript: z.string().nullish(),
    leadScreening: z
      .object({ outcome: z.string().nullish(), qualified: z.boolean().nullish() })
      .nullish(),
    bookedAppointmentId: z.string().nullish(),
  }),
  // Signal always sends both. Optional here so a hand-made test event can
  // leave them out and let the app find or create the contact by phone.
  ghl: z
    .object({ locationId: z.string().nullish(), contactId: z.string().nullish() })
    .nullish(),
});

const ping = z.object({
  event: z.literal("ping"),
  version: z.literal(1),
  deliveryId: z.string(),
  sentAt: z.string(),
  agency,
});

export const signalEventSchema = z.discriminatedUnion("event", [callSynced, ping]);
export type SignalEvent = z.infer<typeof signalEventSchema>;
export type CallSyncedEvent = z.infer<typeof callSynced>;
