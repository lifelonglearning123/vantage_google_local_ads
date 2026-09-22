import { agencies } from "@/lib/agencies";

/**
 * The Signal secret the hand-run scripts sign with: SIGNAL_WEBHOOK_SECRET, or
 * from AGENCIES the agency named by --agency <id>, else the first one.
 */
export function agencySecret(): string {
  const i = process.argv.indexOf("--agency");
  const wanted = i >= 0 ? process.argv[i + 1] : undefined;
  const list = agencies();
  const agency = wanted ? list.find((a) => a.id === wanted) : list[0];
  if (wanted && !agency) {
    throw new Error(`No agency "${wanted}" in AGENCIES. Known: ${list.map((a) => a.id).join(", ") || "none"}.`);
  }
  const secret = agency?.signalWebhookSecret;
  if (!secret) throw new Error("No Signal secret: set SIGNAL_WEBHOOK_SECRET, or AGENCIES with signalWebhookSecret.");
  return secret;
}
