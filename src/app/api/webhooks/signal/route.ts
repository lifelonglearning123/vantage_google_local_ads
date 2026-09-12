import { after, NextResponse, type NextRequest } from "next/server";
import { acceptCall } from "@/lib/qualify/process";
import { SIGNATURE_HEADER, signalEventSchema, verifySignature } from "@/lib/signal/contract";

// Enough for the verdict and the GoHighLevel writes that run after the response.
export const maxDuration = 60;

/**
 * Signal's call webhook, and the app's only real endpoint. Answers once the
 * opportunity is safely in the pipeline (a second or two — Signal waits on
 * this inside its own call ingest) and sorts it after responding. Any non-2xx
 * makes Signal send the call again on its next sync.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SIGNAL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "SIGNAL_WEBHOOK_SECRET is not set" }, { status: 503 });
  }

  const raw = await req.text();
  const signature = verifySignature(raw, req.headers.get(SIGNATURE_HEADER), secret);
  if (!signature.ok) {
    console.warn("[signal-webhook] rejected", { reason: signature.reason });
    return NextResponse.json({ ok: false, error: signature.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // An event type from a newer Signal: acknowledge it, or Signal retries it for a day.
  const eventName = (body as { event?: unknown } | null)?.event;
  if (eventName !== "call.synced" && eventName !== "ping") {
    return NextResponse.json({ ok: true, ignored: `event ${String(eventName)}` });
  }

  const parsed = signalEventSchema.safeParse(body);
  if (!parsed.success) {
    console.warn("[signal-webhook] malformed", { issues: parsed.error.issues.slice(0, 5) });
    return NextResponse.json({ ok: false, error: "payload doesn't match contract v1" }, { status: 400 });
  }

  const event = parsed.data;
  if (event.event === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  try {
    const result = await acceptCall(event);
    if (result.kind !== "accepted") {
      return NextResponse.json({ ok: true, kind: result.kind, reason: result.reason });
    }
    after(async () => {
      const sorted = await result.finish();
      console.log("[signal-webhook] sorted", { callId: event.call.id, opportunityId: result.opportunityId, ...sorted });
    });
    return NextResponse.json({
      ok: true,
      kind: "accepted",
      opportunityId: result.opportunityId,
      created: result.created,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[signal-webhook] not accepted, Signal will send it again", {
      callId: event.call.id,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
