import { classifyCall } from "@/lib/qualify/classify";
import { OUTCOME_LABELS } from "@/lib/qualify/outcomes";
import { SAMPLE_BUSINESS, SAMPLE_CALLS } from "./sample-calls";

/**
 * Runs the REAL qualifier (OpenAI) over the sample calls and checks each one
 * lands where it should. Costs a few pence.
 *
 *   npm run try:qualifier            all samples
 *   npm run try:qualifier -- invoice  just one
 */
async function main() {
  const only = process.argv[2];
  const entries = Object.entries(SAMPLE_CALLS).filter(([name]) => !only || name === only);
  const started = Date.now();

  const results = await Promise.all(
    entries.map(async ([name, call]) => {
      try {
        const verdict = await classifyCall({
          businessName: SAMPLE_BUSINESS.name,
          services: SAMPLE_BUSINESS.services,
          transcript: call.transcript,
          summary: call.summary,
          screeningOutcome: null,
        });
        return { name, call, verdict, error: null };
      } catch (e) {
        return { name, call, verdict: null, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  let wrong = 0;
  for (const { name, call, verdict, error } of results) {
    const ok = verdict?.outcome === call.expect;
    if (!ok) wrong++;
    console.log(
      `${ok ? "✓" : "✗"} ${name.padEnd(13)} expected ${OUTCOME_LABELS[call.expect].padEnd(23)} got ${verdict ? OUTCOME_LABELS[verdict.outcome] : "ERROR"}`,
    );
    if (verdict) {
      const facts = [
        verdict.lostReason,
        verdict.serviceRequested && `wants "${verdict.serviceRequested}"`,
        verdict.matchedService && `matches "${verdict.matchedService}"`,
        `${verdict.confidence} confidence`,
        verdict.decidedBy,
      ].filter(Boolean);
      console.log(`    ${facts.join(" · ")}\n    ${verdict.reasoning}`);
    } else {
      console.log(`    ${error}`);
    }
  }
  console.log(
    `\n${results.length - wrong}/${results.length} as expected in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  process.exit(wrong ? 1 : 0);
}

main();
