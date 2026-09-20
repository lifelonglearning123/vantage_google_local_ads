import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SIGNATURE_HEADER, verifySignature } from "@/lib/signal/contract";

/**
 * Stands in for Signal's call-back endpoint, so call-backs can be tried
 * without a Signal to ring anyone. It checks the signature exactly as Signal
 * does, records what was asked for, and answers "scheduled" for five minutes
 * from now.
 *
 * Used by scripts/verify.ts, and runnable on its own while the app is up:
 *
 *   npm run signal:fake
 *   npm run send:test-call -- --location <id> --scenario hang-up \
 *     --call-back-url http://127.0.0.1:4599/api/call-backs
 */

export type FakeSignalRequest = {
  callId: string;
  reason: string;
  /** The voice the client chose, as Vantage sent it. */
  voiceId: string | null;
  signed: boolean;
};

/** A believable voice list: two men, two women, one already answering calls. */
const FAKE_VOICES = [
  { id: "fake-adam", name: "Adam", gender: "male", accent: "British", provider: "elevenlabs", previewUrl: "https://example.com/adam.mp3" },
  { id: "fake-brian", name: "Brian", gender: "male", accent: "British", provider: "elevenlabs", previewUrl: null },
  { id: "fake-rachel", name: "Rachel", gender: "female", accent: "British", provider: "elevenlabs", previewUrl: null },
  { id: "fake-chad", name: "Chad", gender: "male", accent: "American", provider: "openai", previewUrl: null },
];

export async function startFakeSignal(opts: { secret: string; port?: number; log?: boolean }) {
  const requests: FakeSignalRequest[] = [];
  const state = { refuseNext: null as string | null };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const signed = verifySignature(raw, (req.headers[SIGNATURE_HEADER] as string) ?? null, opts.secret).ok;
      let body: { callId?: string; reason?: string; voiceId?: string | null };
      try {
        body = JSON.parse(raw) as { callId?: string; reason?: string; voiceId?: string | null };
      } catch {
        body = {};
      }
      requests.push({
        callId: body.callId ?? "",
        reason: body.reason ?? "",
        voiceId: body.voiceId ?? null,
        signed,
      });
      const reply = (status: number, json: unknown) => {
        if (opts.log) {
          console.log(
            `${signed ? "signed ok" : "BAD SIGNATURE"} · call ${body.callId} · reason ${body.reason} · voice ${body.voiceId ?? "chosen by Signal"} → ${status}`,
          );
        }
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (!signed) return reply(401, { ok: false, error: "signature does not match" });
      // The voices Signal would serve for a sub-account, so the settings
      // page's picker can be tried without a Signal.
      if (req.url?.includes("/voices")) {
        return reply(200, {
          ok: true,
          voices: FAKE_VOICES,
          receptionistVoiceIds: ["fake-rachel"],
          automatic: "fake-adam",
        });
      }
      if (state.refuseNext) {
        const reason = state.refuseNext;
        state.refuseNext = null;
        return reply(422, { ok: false, refused: "rung_back_recently", reason });
      }
      reply(202, {
        ok: true,
        callBackId: `cb-${requests.length}`,
        status: "scheduled",
        // Signal answers with the moment it will ring and the client's zone.
        dueAt: new Date(Date.now() + 5 * 60_000 + 20_000).toISOString(),
        timezone: "Europe/London",
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/call-backs`,
    requests,
    /** The next request is refused with this reason, as Signal would refuse it. */
    set refuseNext(reason: string | null) {
      state.refuseNext = reason;
    },
    close: () => server.close(),
  };
}

// Run directly: stay up and print every call-back asked for.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/fake-signal.ts")) {
  const secret = process.env.SIGNAL_WEBHOOK_SECRET;
  if (!secret) throw new Error("SIGNAL_WEBHOOK_SECRET is not set.");
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 4599;
  startFakeSignal({ secret, port, log: true }).then((fake) => {
    console.log(`Standing in for Signal at ${fake.url}`);
    console.log(
      "Pass it as --call-back-url. For the settings page's voice picker, set SIGNAL_BASE_URL to its origin. Ctrl-C to stop.",
    );
  });
}
