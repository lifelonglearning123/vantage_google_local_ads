import { signPayload } from "@/lib/signal/contract";
import { SAMPLE_CALLS } from "./sample-calls";

/**
 * Sends a signed call.synced event to a running app, exactly as Signal would.
 *
 *   npm run send:test-call -- --location <GHL location id> [--contact <GHL contact id>]
 *     [--scenario boiler] [--from "+447700900123"] [--outbound]
 *     [--url http://localhost:3000/api/webhooks/signal]
 *   npm run send:test-call -- --ping
 *
 * Call-backs (Signal AGENTS.md, "Call-backs"), against `npm run signal:fake`:
 *
 *   ...--scenario hang-up --call-back-url http://127.0.0.1:4599/api/call-backs
 *     the app asks for a call-back, and the note says when they'll be rung
 *   ...--call-back-of <the call id printed above> [--end-reason voicemail_reached]
 *     the call-back's own result, sorted like any call
 *
 * This DOES write to that sub-account: an opportunity and a note. Without
 * --contact the contact is found, or created, from --from.
 */

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const secret = process.env.SIGNAL_WEBHOOK_SECRET;
  if (!secret) throw new Error("SIGNAL_WEBHOOK_SECRET is not set.");
  const url = arg("url") ?? "http://localhost:3000/api/webhooks/signal";
  const sentAt = new Date().toISOString();
  const deliveryId = crypto.randomUUID();
  const agency = { id: "00000000-0000-4000-8000-000000000001", slug: "test", name: "Test agency" };

  let event: Record<string, unknown>;
  if (flag("ping")) {
    event = { event: "ping", version: 1, deliveryId, sentAt, agency };
  } else {
    const locationId = arg("location");
    if (!locationId) throw new Error("Pass --location with the sub-account's location ID.");
    const scenario = arg("scenario") ?? "boiler";
    const sample = SAMPLE_CALLS[scenario];
    if (!sample) throw new Error(`Unknown --scenario. Try: ${Object.keys(SAMPLE_CALLS).join(", ")}`);
    const signalLine = arg("to") ?? "+441223912555";
    const customer = arg("from") ?? "+447700900123";
    // A call-back is Signal ringing the caller back: outbound, from the line
    // they rang. `--call-back-of` names the call it returns.
    const callBackOf = arg("call-back-of");
    const outbound = flag("outbound") || !!callBackOf;
    event = {
      event: "call.synced",
      version: 1,
      deliveryId,
      sentAt,
      agency,
      client: { id: "00000000-0000-4000-8000-000000000002", name: arg("business") ?? "Test business" },
      call: {
        id: crypto.randomUUID(),
        platform: "retell",
        platformCallId: `test_${Date.now()}`,
        direction: outbound ? "outbound" : "inbound",
        startedAt: sentAt,
        durationSec: 64,
        fromNumber: outbound ? signalLine : customer,
        toNumber: outbound ? customer : signalLine,
        agentPhoneNumber: signalLine,
        callerName: null,
        summary: sample.summary,
        transcript: sample.transcript,
        leadScreening: null,
        bookedAppointmentId: null,
        endReason: arg("end-reason") ?? null,
        callBackOf: callBackOf ? { callId: callBackOf, reason: arg("reason") ?? "hang_up" } : null,
      },
      ghl: { locationId, contactId: arg("contact") ?? null },
      callBackUrl: arg("call-back-url") ?? null,
    };
    console.log(`call id ${(event.call as { id: string }).id}`);
  }

  const raw = JSON.stringify(event);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Signal-Webhooks/1",
      "X-Signal-Event": String(event.event),
      "X-Signal-Delivery": deliveryId,
      "X-Signal-Signature": signPayload(secret, raw, Math.floor(Date.now() / 1000)),
    },
    body: raw,
  });
  console.log(res.status, await res.text());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
