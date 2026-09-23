import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { agencies, agencyBySignature, agencyForHost, agencyOf, agencySetup, type Agency } from "@/lib/agencies";
import { deleteClient, listAgencyClients, listClients, readClient, saveClient, type ClientSettings } from "@/lib/clients";
import { connectClient } from "@/lib/connect";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Pipeline } from "@/lib/ghl";
import { normalizePhone, parsePhoneList } from "@/lib/phone";
import { callBackDecision, callBackNoteLine, callBackWhen } from "@/lib/qualify/call-back";
import { sortVoices, voiceLabel } from "@/lib/qualify/voices";
import {
  buildInstructions,
  classifyCall,
  findService,
  googleAnnouncement,
  nothingFromCaller,
  settleVerdict,
  type ModelVerdict,
} from "@/lib/qualify/classify";
import { callIsOnNumbers, resolveConfig } from "@/lib/qualify/config";
import { planOpportunity, type OpportunityPlan, type StageIds } from "@/lib/qualify/decide";
import { htmlToText, nextHop, readProblem, websiteAddress } from "@/lib/qualify/draft-services";
import type { Classification, Outcome } from "@/lib/qualify/outcomes";
import { acceptCall, noteRef } from "@/lib/qualify/process";
import { parseServices } from "@/lib/qualify/services";
import { guessStage } from "@/lib/qualify/stages";
import {
  decodeSession,
  encodeAgencySession,
  encodeSession,
  isAgencySession,
  loginMatches,
} from "@/lib/session-token";
import {
  signalEventSchema,
  signPayload,
  verifySignature,
  type CallSyncedEvent,
} from "@/lib/signal/contract";
import { FAKE_LOCATION, FAKE_TOKEN, startFakeGhl } from "./fake-ghl";
import { startFakeSignal } from "./fake-signal";

/**
 * Everything that doesn't need a real GoHighLevel, OpenAI or Blob store: the
 * pure rules, sessions, settings files on disk, and the whole call flow
 * against a fake GoHighLevel with a stand-in qualifier.   npm run verify
 */

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    return;
  }
  failures.push(name);
  const extra = detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  console.log(`  ✗ ${name}${extra}`);
}

const section = (title: string) => console.log(`\n${title}`);
const samePlan = (a: OpportunityPlan, b: OpportunityPlan) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  section("Phone numbers");
  check("UK national → E.164", normalizePhone("01223 912555") === "+441223912555");
  check("+44 (0) form", normalizePhone("+44 (0)1223 912555") === "+441223912555");
  check("no country code refused", normalizePhone("7700900123") === null);
  const phoneList = parsePhoneList("01223 912555, +44 1223 912555; 07700 900123\nnope");
  check("list dedupes and flags junk", phoneList.numbers.length === 2 && phoneList.invalid.join() === "nope", phoneList);

  section("Signal signature");
  const secret = "s".repeat(32);
  const body = JSON.stringify({ hello: "world" });
  const t = 1_800_000_000;
  const hmac = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  check("header format matches the contract", signPayload(secret, body, t) === `t=${t},v1=${hmac}`);
  check("valid signature accepted", verifySignature(body, signPayload(secret, body, t), secret, t + 10).ok);
  check("tampered body rejected", !verifySignature(`${body} `, signPayload(secret, body, t), secret, t).ok);
  check("wrong secret rejected", !verifySignature(body, signPayload("x".repeat(32), body, t), secret, t).ok);
  check("stale timestamp rejected", !verifySignature(body, signPayload(secret, body, t), secret, t + 301).ok);
  check("missing header rejected", !verifySignature(body, null, secret, t).ok);
  check(
    "any matching v1 accepted (secret rotation)",
    verifySignature(body, `t=${t},v1=${"0".repeat(64)},v1=${hmac}`, secret, t).ok,
  );

  section("Contract v1");
  check("call.synced parses", signalEventSchema.safeParse(makeEvent({})).success);
  const withCallBack = signalEventSchema.safeParse(
    makeEvent({ direction: "outbound", callBackOf: { callId: "call-0", reason: "hang_up" }, endReason: "user_hangup", callBackUrl: "https://signal.example/api/call-backs" }),
  );
  check(
    "call-back fields parse (callBackUrl, callBackOf, endReason)",
    withCallBack.success &&
      withCallBack.data.event === "call.synced" &&
      withCallBack.data.call.callBackOf?.callId === "call-0" &&
      withCallBack.data.callBackUrl === "https://signal.example/api/call-backs",
  );
  check(
    "ping parses",
    signalEventSchema.safeParse({
      event: "ping",
      version: 1,
      deliveryId: "d",
      sentAt: new Date().toISOString(),
      agency: { id: "a", slug: "s", name: "n" },
    }).success,
  );
  check("other versions rejected", !signalEventSchema.safeParse({ ...makeEvent({}), version: 2 }).success);

  section("Qualifier guards");
  const services = ["Boiler repairs", "Blocked drains", "Bathroom fitting"];
  const base: ModelVerdict = {
    outcome: "qualified",
    lost_reason: null,
    service_requested: "boiler repair",
    matched_service: "Boiler repairs",
    caller_name: "Dave",
    confidence: "high",
    reasoning: "Wants a boiler fixed.",
  };
  check("clean qualified stays qualified", settleVerdict(base, services, "m").outcome === "qualified");
  check(
    "near-miss service name still matches the list entry",
    settleVerdict({ ...base, matched_service: "boiler repair" }, services, "m").matchedService === "Boiler repairs",
  );
  check(
    "qualified with no list match → Qualification Required",
    settleVerdict({ ...base, matched_service: "Roofing" }, services, "m").outcome === "qualification_required",
  );
  check(
    "low-confidence lost → Qualification Required",
    settleVerdict({ ...base, outcome: "lost", lost_reason: "sales_pitch", matched_service: null, confidence: "low" }, services, "m")
      .outcome === "qualification_required",
  );
  check(
    "lost without a reason → Qualification Required",
    settleVerdict({ ...base, outcome: "lost", lost_reason: null, matched_service: null }, services, "m").outcome ===
      "qualification_required",
  );
  const confidentLost = settleVerdict(
    { ...base, outcome: "lost", lost_reason: "job_seeker", matched_service: null, confidence: "medium" },
    services,
    "m",
  );
  check(
    "confident lost keeps its reason and drops the service",
    confidentLost.outcome === "lost" && confidentLost.lostReason === "job_seeker" && confidentLost.serviceRequested === null,
  );
  const ceiling: ModelVerdict = {
    ...base,
    outcome: "lost",
    lost_reason: "not_offered",
    service_requested: "Ceiling patch repair",
    matched_service: null,
  };
  const notOffered = settleVerdict(ceiling, services, "m");
  check(
    "a clear job the business doesn't do → lost, keeping the job",
    notOffered.outcome === "lost" && notOffered.lostReason === "not_offered" && notOffered.serviceRequested === "Ceiling patch repair",
    notOffered,
  );
  check(
    "not a job we do, but it's on the list → Qualification Required",
    settleVerdict({ ...ceiling, service_requested: "Blocked drain" }, services, "m").outcome === "qualification_required",
  );
  check(
    "not a job we do, with no job named → Qualification Required",
    settleVerdict({ ...ceiling, service_requested: null }, services, "m").outcome === "qualification_required",
  );
  check(
    "not a job we do, with no services list → Qualification Required",
    settleVerdict(ceiling, [], "m").outcome === "qualification_required",
  );
  check(
    "not a job we do, low confidence → Qualification Required",
    settleVerdict({ ...ceiling, confidence: "low" }, services, "m").outcome === "qualification_required",
  );
  check("'null' caller name cleaned up", settleVerdict({ ...base, caller_name: "null" }, services, "m").callerName === null);
  check("unrelated service doesn't match", findService("Electrical rewiring", services) === null);
  check("agent-only transcript needs no model", nothingFromCaller({ transcript: "Agent: Hello, how can I help?", summary: "Silent." }));
  check("caller speech goes to the model", !nothingFromCaller({ transcript: "Agent: Hello\nUser: My drain's blocked", summary: null }));
  check("unlabelled text goes to the model", !nothingFromCaller({ transcript: "my drain is blocked", summary: null }));
  check("no transcript or summary needs no model", nothingFromCaller({ transcript: null, summary: null }));

  section("Google's announcement (\"Call from Google\")");
  const nickDyer = "User: Call from Google.\nAgent: Hi, I'm Louise, a virtual assistant at Nick Dyer Construction. Are you looking into a renovation?";
  const g = googleAnnouncement(nickDyer);
  check(
    "taken off the caller's first line, and the call marked as a Google ad call",
    g.announced && g.transcript?.split("\n")[0].trim() === "User:" && g.transcript?.includes("Agent: Hi, I'm Louise") === true,
    g,
  );
  check("with it gone, the caller said nothing", nothingFromCaller({ transcript: g.transcript, summary: null }));
  for (const said of ["Call from Google", "call from google", "Call from Google Local Services.", "Called from Google.", "This is a call from Google."]) {
    check(`recognised: "${said}"`, googleAnnouncement(`User: ${said}\nAgent: Hello`).announced);
  }
  const merged = googleAnnouncement("User: Call from Google. Hi, my drain's blocked.\nAgent: Let me help.");
  check("the caller's own words on the same line are kept", merged.announced && merged.transcript?.startsWith("User: Hi, my drain's blocked.") === true, merged);
  for (const said of [
    "I'm calling from Google about your business listing",
    "Calling from Google Ads about your account",
    "I got your number from Google",
    "Call from Googleplex",
  ]) {
    check(`not the announcement: "${said}"`, !googleAnnouncement(`Agent: Hello\nUser: ${said}`).announced);
  }
  check(
    "only the caller's first line counts",
    !googleAnnouncement("Agent: Hello\nUser: My drain's blocked\nUser: Call from Google").announced,
  );
  check("an unlabelled transcript that opens with it", googleAnnouncement("Call from Google. Need a builder.").transcript === "Need a builder.");
  check("no transcript, nothing announced", !googleAnnouncement(null).announced);

  const googleHangUp = await classifyCall({
    businessName: "Nick Dyer Construction",
    services: ["Extensions", "Loft conversions"],
    transcript: nickDyer,
    summary: "The user called and identified the call as from Google. The agent introduced herself as Louise. The call ended shortly after without further interaction.",
    screeningOutcome: null,
    endReason: "user_hangup",
  });
  check(
    "the Nick Dyer call: Not clear yet, or hung up, decided by rule without the model",
    googleHangUp.outcome === "qualification_required" && googleHangUp.decidedBy === "rule" && /Google put this call through/.test(googleHangUp.reasoning),
    googleHangUp,
  );
  check(
    "a confident lost stands (a Google ad call is judged the same)",
    settleVerdict({ ...base, outcome: "lost", lost_reason: "sales_pitch", matched_service: null }, services, "m").outcome === "lost",
  );
  const told = buildInstructions({ businessName: "B", services, transcript: null, summary: null, screeningOutcome: null }, { googleAd: true });
  check("the model is told the words were Google's", /Google said "Call from Google"/.test(told));
  check("a Google ad caller can be lost: a seller or job seeker through the ad", !/Never choose "lost"/.test(told));
  check("the model is told about jobs the business doesn't do", /- not_offered:/.test(told));
  check(
    "other calls get no Google note",
    !/Call from Google/.test(buildInstructions({ businessName: "B", services, transcript: null, summary: null, screeningOutcome: null })),
  );

  section("Stage rules");
  const S: StageIds = { newLeads: "st-new", qualificationRequired: "st-qr", qualified: "st-q", lost: null };
  const plan = (o: Outcome, stageId: string, stages = S) => planOpportunity(o, stageId, stages);
  check("New Leads + qualified → Qualified", samePlan(plan("qualified", "st-new"), { action: "move", stageId: "st-q", status: "open" }));
  check("New Leads + QR → Qualification Required", samePlan(plan("qualification_required", "st-new"), { action: "move", stageId: "st-qr", status: "open" }));
  check("New Leads + lost, no Lost stage → stays put, marked lost", samePlan(plan("lost", "st-new"), { action: "move", stageId: "st-new", status: "lost" }));
  check(
    "New Leads + lost with a Lost stage → Lost stage",
    samePlan(plan("lost", "st-new", { ...S, lost: "st-lost" }), { action: "move", stageId: "st-lost", status: "lost" }),
  );
  check("QR + qualified → moves forward", plan("qualified", "st-qr").action === "move");
  check("Qualified + QR → left (never backwards)", plan("qualification_required", "st-q").action === "leave");
  check("QR + QR → left", plan("qualification_required", "st-qr").action === "leave");
  check("Qualified + lost → left", plan("lost", "st-q").action === "leave");
  check("QR + lost → marked lost", samePlan(plan("lost", "st-qr"), { action: "move", stageId: "st-qr", status: "lost" }));
  check("a salesperson's stage → left", plan("qualified", "st-quote").action === "leave");

  section("Client settings checked against the live pipeline");
  const stage = (id: string, name: string) => ({ id, name });
  const sales: Pipeline = {
    id: "p-sales",
    name: "Sales",
    stages: [stage("st-new", "New Leads"), stage("st-qr", "Qualification Required"), stage("st-q", "Qualified"), stage("st-lost", "Lost")],
  };
  const chosen = {
    numbers: ["+441223912555"],
    pipelineId: "p-sales",
    stages: { newLeads: "st-new", qualified: "st-q", qualificationRequired: "st-qr", lost: null },
    services: ["Boiler repairs"],
  };
  check("complete settings are live", resolveConfig(chosen, [sales]).problems.length === 0, resolveConfig(chosen, [sales]));
  check("no number → not live", resolveConfig({ ...chosen, numbers: [] }, [sales]).problems.some((p) => p.includes("Signal number")));
  check("no pipeline chosen → not live", resolveConfig({ ...chosen, pipelineId: null }, [sales]).problems.length > 0);
  const pipelineGone = resolveConfig({ ...chosen, pipelineId: "p-gone" }, [sales]);
  check("pipeline deleted in GoHighLevel → says so", !pipelineGone.pipeline && pipelineGone.problems.some((p) => p.includes("no longer exists")));
  const stageGone = resolveConfig(chosen, [{ ...sales, stages: sales.stages.filter((s) => s.id !== "st-q") }]);
  check(
    "stage deleted in GoHighLevel → asks for it again",
    stageGone.stages.qualified === null && stageGone.problems.some((p) => p.includes("Qualified")),
    stageGone.problems,
  );
  const lostGone = resolveConfig({ ...chosen, stages: { ...chosen.stages, lost: "st-gone" } }, [sales]);
  check("a deleted optional Lost stage isn't a problem", lostGone.problems.length === 0 && lostGone.stages.lost === null);
  check("no services → not live", resolveConfig({ ...chosen, services: [] }, [sales]).problems.some((p) => p.includes("services")));
  const inbound = { direction: "inbound" as const, fromNumber: "+447700900123" };
  check("a chosen number matches however it's written", callIsOnNumbers(["+441223912555"], { ...inbound, toNumber: "01223 912555", agentPhoneNumber: null }));
  check("other numbers don't match", !callIsOnNumbers(["+441223912555"], { ...inbound, toNumber: "+441223000000", agentPhoneNumber: "+441223000000" }));
  check(
    "a call-back matches on the number it rang from",
    callIsOnNumbers(["+441223912555"], { direction: "outbound", fromNumber: "+441223912555", toNumber: "+447700900123", agentPhoneNumber: null }),
  );
  check(
    "a call-back isn't matched on the customer's number",
    !callIsOnNumbers(["+447700900123"], { direction: "outbound", fromNumber: "+441223912555", toNumber: "+447700900123", agentPhoneNumber: null }),
  );
  check(
    "stages pre-selected by name",
    guessStage(sales.stages, "qualificationRequired") === "st-qr" && guessStage(sales.stages, "qualified") === "st-q" && guessStage(sales.stages, "lost") === "st-lost",
  );
  check(
    "one-line services: semicolons win, so a service can hold a comma",
    parseServices("Taps, toilets and showers; Blocked drains").join("|") === "Taps, toilets and showers|Blocked drains",
  );
  check("one-line services without semicolons split on commas", parseServices("Boiler repairs, Blocked drains").length === 2);
  check("bullets stripped, duplicates dropped", parseServices("- Boiler repairs\n• Drains\nDrains").join("|") === "Boiler repairs|Drains");

  section("Call-backs (rules)");
  const qr = (decidedBy = "stand-in"): Classification => ({
    outcome: "qualification_required",
    lostReason: null,
    serviceRequested: null,
    matchedService: null,
    callerName: null,
    confidence: "high",
    reasoning: "test",
    decidedBy,
  });
  const askFor = (over: Partial<Parameters<typeof callBackDecision>[0]> = {}, event = makeEvent({ callBackUrl: "https://signal.example/api/call-backs" })) =>
    callBackDecision({
      enabled: true,
      event,
      verdict: qr(),
      sorted: true,
      finalStageId: "st-qr",
      qualificationRequiredStageId: "st-qr",
      ...over,
    });
  const hangUp = askFor({ verdict: qr("rule") });
  check("hang-up decided by rule → ask, reason hang_up", hangUp.ask && hangUp.reason === "hang_up", hangUp);
  const unclear = askFor();
  check("unclear call → ask, reason unclear", unclear.ask && unclear.reason === "unclear", unclear);
  const off = askFor({ enabled: false });
  check("call-backs off → nothing, and nothing said", !off.ask && off.why === null);
  check("qualified caller → no call-back", !askFor({ verdict: { ...qr(), outcome: "qualified" } }).ask);
  check("lost caller → no call-back", !askFor({ verdict: { ...qr(), outcome: "lost" } }).ask);
  check("couldn't be sorted → no call-back", !askFor({ sorted: false }).ask);
  const further = askFor({ finalStageId: "st-q" });
  check("opportunity already further along → no call-back, and says why", !further.ask && !!further.why, further);
  const withheld = askFor({}, makeEvent({ callBackUrl: "https://signal.example/api/call-backs", withheld: true }));
  check("withheld number → says so", !withheld.ask && /withheld/.test(withheld.why ?? ""), withheld);
  const noUrl = askFor({}, makeEvent({}));
  check("Signal offered no call-back → says so", !noUrl.ask && !!noUrl.why, noUrl);
  const ofCallBack = askFor({}, makeEvent({ direction: "outbound", callBackOf: { callId: "call-0", reason: "hang_up" }, callBackUrl: "https://signal.example/api/call-backs" }));
  check("a call-back's own result never asks for another", !ofCallBack.ask && ofCallBack.why === null);
  const now = new Date("2026-09-15T10:00:00Z");
  check("due soon → in about N minutes", callBackWhen(new Date(now.getTime() + 5 * 60_000), now, "Europe/London") === "in about 5 minutes");
  check("due tomorrow → local time tomorrow", callBackWhen(new Date("2026-09-16T08:00:00Z"), now, "Europe/London") === "at 09:00 tomorrow");
  check("due later in the week → names the day", callBackWhen(new Date("2026-09-19T08:00:00Z"), now, "Europe/London") === "at 09:00 on Saturday");
  check(
    "note line for a scheduled call-back",
    callBackNoteLine({ kind: "scheduled", dueAt: new Date(now.getTime() + 5 * 60_000), timezone: "Europe/London" }, now) ===
      "Call-back: the AI receptionist will ring them back in about 5 minutes.",
  );
  check("note line for a refusal carries Signal's reason", callBackNoteLine({ kind: "refused", reason: "They rang again first." }, now) === "Call-back: not made. They rang again first.");
  const voiceList = {
    agency: { slug: "test-agency", name: "Test agency" },
    voices: [
      { id: "v-rec", name: "Rachel", gender: "female", accent: "British", provider: "elevenlabs", previewUrl: "https://x/1" },
      { id: "v-m1", name: "Adam", gender: "male", accent: "British", provider: "elevenlabs", previewUrl: "https://x/2" },
      { id: "v-f1", name: "Alice", gender: "female", accent: "British", provider: "elevenlabs", previewUrl: null },
      { id: "v-m2", name: "Brian", gender: "male", accent: "American", provider: "elevenlabs", previewUrl: null },
    ],
    receptionistVoiceIds: ["v-rec"],
    automatic: "v-m1",
  };
  const ordered = sortVoices(voiceList).map((v) => v.id);
  check("voices: men first, the receptionist's own voice last", ordered.join() === "v-m1,v-m2,v-f1,v-rec", ordered);
  check("a voice reads as name, gender and accent", voiceLabel(voiceList.voices[1]) === "Adam · male · British");

  const voicemail = await classifyCall({
    businessName: "Hartley",
    services: ["Boiler repairs"],
    transcript: "User: Hi, you've reached Dave, leave a message.",
    summary: null,
    screeningOutcome: null,
    endReason: "voicemail_reached",
    callBack: true,
  });
  check(
    "call-back that reached voicemail: decided by rule, not the model",
    voicemail.outcome === "qualification_required" && voicemail.decidedBy === "rule" && /voicemail/.test(voicemail.reasoning),
    voicemail,
  );

  section("Website addresses (for suggesting services)");
  const addr = (raw: string) => websiteAddress(raw);
  const urlOf = (raw: string) => {
    const a = addr(raw);
    return a.ok ? a.url : null;
  };
  check("a bare domain gets https", urlOf("www.jselectricalswindon.co.uk") === "https://www.jselectricalswindon.co.uk/");
  check("http and a path are kept", urlOf(" http://example.co.uk/services ") === "http://example.co.uk/services");
  check("the host is named for messages", (addr("https://WWW.Example.co.uk/x") as { host: string }).host === "www.example.co.uk");
  check("empty asks for an address", !addr("  ").ok && /Enter the website/.test((addr("") as { message: string }).message));
  for (const bad of [
    "localhost",
    "http://localhost:3000",
    "127.0.0.1",
    "http://2130706433",
    "http://0x7f.1",
    "http://[::1]/",
    "169.254.169.254/latest/meta-data",
    "https://example.co.uk:8443",
    "info@leonardopower.com",
    "https://user:pass@example.co.uk",
    "ftp://example.co.uk",
    "javascript:alert(1)",
    "printer.local",
    "intranet",
    "not a website",
  ]) {
    check(`refused: ${bad}`, !addr(bad).ok, addr(bad));
  }
  check("a redirect to a path on the same site is followed", nextHop("/services", "https://example.co.uk/") === "https://example.co.uk/services");
  check("a redirect onto a private address is refused", nextHop("http://169.254.169.254/latest", "https://example.co.uk/") === null);
  check("a redirect to localhost is refused", nextHop("http://localhost:9001/", "https://example.co.uk/") === null);
  const failedWith = (code: string) => readProblem(Object.assign(new TypeError("fetch failed"), { cause: { code } }));
  check("no such domain reads as no website there", failedWith("ENOTFOUND") === "there's no website at that address");
  check("a bad certificate says so", failedWith("ERR_TLS_CERT_ALTNAME_INVALID") === "its security certificate isn't valid");
  check("an expired certificate says so", failedWith("CERT_HAS_EXPIRED") === "its security certificate has expired");
  check("a refused connection says so", failedWith("ECONNREFUSED") === "the site refused the connection");
  check("a timeout says so", readProblem(Object.assign(new Error("x"), { name: "TimeoutError" })) === "the site took too long to answer");
  check("an unknown network failure is still in words", failedWith("EWHATEVER") === "the site couldn't be reached");
  check("the site's own answer is kept", readProblem(new Error("the site answered 404")) === "the site answered 404");

  section("Website text (for suggesting services)");
  const page =
    '<html><head><title>Hartley Plumbing</title><meta name="description" content="Boiler repairs in Cambridge"><style>.x{color:red}</style></head>' +
    "<body><script>var tracking=1</script><h1>Our services</h1><ul><li>Boiler repairs</li><li>Blocked&nbsp;drains &amp; sinks</li></ul></body></html>";
  const pageText = htmlToText(page);
  check(
    "keeps the title, description and body text",
    pageText.includes("Hartley Plumbing") && pageText.includes("Boiler repairs in Cambridge") && pageText.includes("Blocked drains & sinks"),
    pageText,
  );
  check("drops scripts, styles and markup", !/tracking|color:red|<li>/.test(pageText), pageText);

  section("Sign-in session and token encryption");
  const sessionSecret = "k".repeat(40);
  const cookie = encodeSession("loc1", sessionSecret, 1_000);
  check("session names the sub-account", decodeSession(cookie, sessionSecret, 2_000) === "loc1");
  const tampered = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
  check("tampered session refused", decodeSession(tampered, sessionSecret, 2_000) === null);
  check("session signed with another secret refused", decodeSession(cookie, "x".repeat(40), 2_000) === null);
  check("expired session refused", decodeSession(cookie, sessionSecret, 1_000 + 8 * 24 * 3600 * 1000) === null);
  check("no secret → no session", decodeSession(cookie, "", 2_000) === null);
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const sealed = encryptSecret("pit-123");
  check("token encryption round-trips and hides the token", decryptSecret(sealed) === "pit-123" && !sealed.includes("pit-123"));

  section("Agency sign-in");
  const login = { username: "agency", password: "correct horse battery" };
  const agencyCookie = encodeAgencySession("vantage", login, sessionSecret, 1_000);
  check("agency session accepted", isAgencySession(agencyCookie, "vantage", login, sessionSecret, 2_000));
  check(
    "changing the agency password signs the agency out",
    !isAgencySession(agencyCookie, "vantage", { ...login, password: "a brand new password" }, sessionSecret, 2_000),
  );
  check(
    "one agency's session doesn't pass as another's, even with the same login",
    !isAgencySession(agencyCookie, "leonardo", login, sessionSecret, 2_000),
  );
  check("expired agency session refused", !isAgencySession(agencyCookie, "vantage", login, sessionSecret, 1_000 + 8 * 24 * 3600 * 1000));
  const agencyTampered = agencyCookie.slice(0, -1) + (agencyCookie.endsWith("A") ? "B" : "A");
  check("tampered agency session refused", !isAgencySession(agencyTampered, "vantage", login, sessionSecret, 2_000));
  check("a client's session doesn't pass as the agency's", !isAgencySession(cookie, "vantage", login, sessionSecret, 2_000));
  check("the agency's session doesn't pass as a client's", decodeSession(agencyCookie, sessionSecret, 2_000) === null);
  check("no session secret → no agency session", !isAgencySession(agencyCookie, "vantage", login, "", 2_000));
  check("right username and password match", loginMatches(login, "agency", "correct horse battery"));
  check("wrong password doesn't match", !loginMatches(login, "agency", "correct horse batter"));
  check("wrong username doesn't match", !loginMatches(login, "Agency", "correct horse battery"));

  section("Agencies, told apart by domain (AGENCIES)");
  for (const key of ["AGENCIES", "AGENCY_USERNAME", "AGENCY_PASSWORD", "SIGNAL_WEBHOOK_SECRET"]) delete process.env[key];
  check("nothing set: sign-in off, with a reason", !agencySetup().ok && agencies().length === 0);
  process.env.SIGNAL_WEBHOOK_SECRET = "s".repeat(20);
  const secretOnly = agencies();
  check(
    "only the Signal secret: one agency on every host that sorts calls but has no sign-in",
    secretOnly.length === 1 && secretOnly[0].login === null && agencyForHost("anything.example")?.id === "default",
    secretOnly,
  );
  process.env.AGENCY_USERNAME = "agency";
  process.env.AGENCY_PASSWORD = "short";
  check("legacy password too short: refused with a reason", !agencySetup().ok && /12 characters/.test((agencySetup() as { reason: string }).reason));
  process.env.AGENCY_PASSWORD = "correct horse battery";
  check(
    "legacy AGENCY_USERNAME / AGENCY_PASSWORD / SIGNAL_WEBHOOK_SECRET: one agency that signs in",
    agencies()[0]?.login?.username === "agency" && agencies()[0]?.signalWebhookSecret === "s".repeat(20),
  );
  const two = [
    { id: "vantage", name: "Vantage", host: "Vantage.Example.com", username: "chao", password: "correct horse battery", signalWebhookSecret: "v".repeat(20) },
    { id: "leonardo", host: "vantage.leonardo.example", username: "leo", password: "battery horse correct", signalWebhookSecret: "l".repeat(20) },
  ];
  process.env.AGENCIES = JSON.stringify(two);
  const listed = agencies();
  check("AGENCIES wins over the legacy variables, in the order written", listed.map((a) => a.id).join() === "vantage,leonardo", listed);
  check("a name defaults to the id, and hosts are lower-cased", listed[1].name === "leonardo" && listed[0].host === "vantage.example.com");
  check("the host picks the agency, port and case aside", agencyForHost("VANTAGE.example.com:3000")?.id === "vantage");
  check("an unknown host is nobody's", agencyForHost("vantage-google-local-ads.vercel.app") === null && agencyForHost(null) === null);
  check("a file naming an agency belongs to it", agencyOf({ agency: "leonardo" })?.id === "leonardo");
  check("a file naming no agency, or an unknown one, belongs to the first", agencyOf({})?.id === "vantage" && agencyOf({ agency: "gone" })?.id === "vantage");
  const signedBody = JSON.stringify({ event: "ping" });
  const leoHeader = signPayload("l".repeat(20), signedBody, Math.floor(Date.now() / 1000));
  check("the signature says which agency's Signal sent a call", (agencyBySignature(signedBody, leoHeader) as { agency: Agency }).agency?.id === "leonardo");
  const strangerHeader = signPayload("x".repeat(20), signedBody, Math.floor(Date.now() / 1000));
  const stranger = agencyBySignature(signedBody, strangerHeader);
  check("a signature from no agency's secret is refused", !stranger.ok && /any agency/.test((stranger as { reason: string }).reason), stranger);
  process.env.AGENCIES = JSON.stringify([two[0], { ...two[1], id: "vantage" }]);
  check("two agencies with one id: refused", /same id/.test((agencySetup() as { reason: string }).reason ?? ""));
  process.env.AGENCIES = JSON.stringify([{ ...two[0], password: "short" }]);
  check("a short password names the agency and the field", /agency 1, password/.test((agencySetup() as { reason: string }).reason ?? ""), agencySetup());
  process.env.AGENCIES = "{not json";
  check("broken JSON: sign-in off with a reason, no agencies", !agencySetup().ok && agencies().length === 0);
  // The rest runs as two agencies: ours on any host, and another one.
  process.env.AGENCIES = JSON.stringify([
    { id: "vantage", name: "Vantage", host: "*", username: "agency", password: "correct horse battery", signalWebhookSecret: "s".repeat(20) },
    { id: "other", name: "Other", host: "other.example", username: "other", password: "battery horse correct", signalWebhookSecret: "o".repeat(20) },
  ]);
  const [AGENCY, OTHER]: Agency[] = agencies();
  const accept = (e: CallSyncedEvent, deps?: Parameters<typeof acceptCall>[2]) => acceptCall(e, AGENCY, deps);

  section("Client settings files (localhost storage)");
  const clientsDir = mkdtempSync(path.join(tmpdir(), "lq-clients-"));
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  process.env.CLIENTS_DIR = path.join(clientsDir, "not-made-yet");
  check("no settings folder yet → no clients listed", (await listClients()).length === 0);
  process.env.CLIENTS_DIR = clientsDir;
  check("unknown sub-account reads as not connected", (await readClient("nobody")) === null);
  check("odd location ids never touch the disk", (await readClient("../../etc")) === null);
  const saved = makeSettings();
  await saveClient(saved);
  check("saved settings read back unchanged", JSON.stringify(await readClient(FAKE_LOCATION)) === JSON.stringify(saved));
  await saveClient(makeSettings({ locationId: "loc2", businessName: "Abbey Electrical" }));
  writeFileSync(path.join(clientsDir, "notes.txt"), "not a client");
  const listedIds = (await listClients()).map((c) => c.locationId);
  check("every client listed by business name, other files ignored", listedIds.join() === "loc2,loc1", listedIds);
  await saveClient(makeSettings({ locationId: "loc3", businessName: "Zed Roofing", agency: "other" }));
  check(
    "an agency lists its own clients and the unnamed ones, never another's",
    (await listAgencyClients(AGENCY)).map((c) => c.locationId).join() === "loc2,loc1" &&
      (await listAgencyClients(OTHER)).map((c) => c.locationId).join() === "loc3",
  );
  await deleteClient("loc3");
  await deleteClient("loc2");
  await deleteClient(FAKE_LOCATION);
  check(
    "disconnected settings are gone, and off the list",
    (await readClient(FAKE_LOCATION)) === null && (await listClients()).length === 0,
  );

  section("Connecting a sub-account (fake GoHighLevel)");
  const ghl = await startFakeGhl();
  process.env.GHL_API_BASE = ghl.url;
  const wrongToken = await connectClient(FAKE_LOCATION, "pit-wrong-token", AGENCY.id, "client");
  check(
    "wrong token: GoHighLevel's reason, nothing saved",
    !wrongToken.ok && /refused/i.test(wrongToken.error) && (await readClient(FAKE_LOCATION)) === null,
    wrongToken,
  );
  const askedBefore = ghl.log.length;
  const oddId = await connectClient("../loc1", FAKE_TOKEN, AGENCY.id, "client");
  check("odd location ID refused before GoHighLevel is asked", !oddId.ok && ghl.log.length === askedBefore, oddId);
  const connected = await connectClient(FAKE_LOCATION, FAKE_TOKEN, AGENCY.id, "client");
  check(
    "right token: saved with the business name and the agency, nothing chosen yet",
    connected.ok &&
      connected.settings.businessName === "Hartley Plumbing & Heating" &&
      connected.settings.agency === AGENCY.id &&
      (await readClient(FAKE_LOCATION))?.pipelineId === null,
    connected,
  );
  await saveClient(makeSettings());
  const reconnected = await connectClient(FAKE_LOCATION, FAKE_TOKEN, AGENCY.id, "client");
  check(
    "connecting again keeps the chosen settings",
    reconnected.ok && reconnected.settings.pipelineId === "p-sales" && reconnected.settings.services.length === 3,
    reconnected,
  );
  const poached = await connectClient(FAKE_LOCATION, FAKE_TOKEN, OTHER.id, "agency");
  check(
    "another agency can't add a sub-account that's already someone's client",
    !poached.ok && /another agency/.test(poached.error) && agencyOf((await readClient(FAKE_LOCATION)) ?? {})?.id === AGENCY.id,
    poached,
  );
  const elsewhere = await connectClient(FAKE_LOCATION, FAKE_TOKEN, OTHER.id, "client");
  check(
    "the client can still sign in on another agency's domain, and stays with their agency",
    elsewhere.ok && agencyOf(elsewhere.settings)?.id === AGENCY.id,
    elsewhere,
  );
  ghl.log.length = 0;

  section("Whole flow (fake GoHighLevel, stand-in qualifier)");
  await saveClient(makeSettings());

  const verdict =
    (outcome: Outcome, over: Partial<Classification> = {}) =>
    async (): Promise<Classification> => ({
      outcome,
      lostReason: outcome === "lost" ? "sales_pitch" : null,
      serviceRequested: outcome === "lost" ? null : "boiler repair",
      matchedService: outcome === "qualified" ? "Boiler repairs" : null,
      callerName: "Dave",
      confidence: "high",
      reasoning: "test",
      decidedBy: "stand-in",
      ...over,
    });
  const run = async (e: CallSyncedEvent, classify: () => Promise<Classification>) => {
    const accepted = await accept(e, { classify });
    const finished = accepted.kind === "accepted" ? await accepted.finish() : null;
    return { accepted, finished };
  };
  const oppsOf = (contactId: string | undefined) => ghl.opps.filter((o) => o.contactId === contactId);
  const notesOf = (contactId: string) => ghl.notes.filter((x) => x.contactId === contactId);

  check("outbound call ignored", (await accept(makeEvent({ direction: "outbound" }))).kind === "ignored");
  check("sub-account that isn't connected: ignored", (await accept(makeEvent({ locationId: "loc2" }))).kind === "ignored");
  const otherAgency = await acceptCall(makeEvent({ contactId: "c-other" }), OTHER, { classify: verdict("qualified") });
  check(
    "a call signed by another agency's Signal about this client: ignored, nothing written",
    otherAgency.kind === "ignored" && /another agency/.test(otherAgency.reason) && oppsOf("c-other").length === 0,
    otherAgency,
  );
  const offList = await accept(makeEvent({ contactId: "c-offlist", to: "+441223000000" }), { classify: verdict("qualified") });
  check("call to a number the client didn't choose: ignored", offList.kind === "ignored", offList);
  check("ignored calls never reach GoHighLevel", ghl.log.length === 0, ghl.log);

  const first = makeEvent({ contactId: "c-dave" });
  const a1 = await accept(first, { classify: verdict("qualified") });
  check("new caller: accepted with a new opportunity", a1.kind === "accepted" && a1.created, a1);
  check("new caller: in New Leads before the verdict", oppsOf("c-dave")[0]?.pipelineStageId === "st-new");
  const f1 = a1.kind === "accepted" ? await a1.finish() : null;
  check("new caller: moved to Qualified", oppsOf("c-dave")[0]?.pipelineStageId === "st-q" && f1?.action === "moved", f1);
  check("new caller: renamed from the placeholder", oppsOf("c-dave")[0]?.name === "Dave – boiler repair", oppsOf("c-dave")[0]?.name);
  check(
    "new caller: note says why and carries the call reference",
    notesOf("c-dave").some((x) => x.body.includes("Call qualification: Qualified") && x.body.includes(noteRef(first.call.id))),
    notesOf("c-dave"),
  );
  const writesBefore = ghl.opps.length + ghl.notes.length;
  check("same call sent again → duplicate", (await accept(first)).kind === "duplicate");
  check("duplicate writes nothing", ghl.opps.length + ghl.notes.length === writesBefore);

  const repeat = await run(makeEvent({ contactId: "c-dave" }), verdict("qualification_required"));
  check("repeat caller: same opportunity", repeat.accepted.kind === "accepted" && !repeat.accepted.created && oppsOf("c-dave").length === 1);
  check("repeat caller: not moved backwards", oppsOf("c-dave")[0]?.pipelineStageId === "st-q" && repeat.finished?.action === "left", repeat.finished);

  await run(makeEvent({ contactId: "c-seo" }), verdict("lost"));
  const seo = oppsOf("c-seo")[0];
  check("sales pitch: marked lost, stays in New Leads", seo?.status === "lost" && seo.pipelineStageId === "st-new", seo);
  check("sales pitch: named by the reason", !!seo?.name.endsWith("Sales pitch"), seo?.name);

  ghl.opps.push({
    id: "opp-quote",
    name: "Kitchen job",
    status: "open",
    pipelineId: "p-sales",
    pipelineStageId: "st-quote",
    contactId: "c-quote",
    locationId: FAKE_LOCATION,
    updatedAt: new Date().toISOString(),
  });
  const quote = await run(makeEvent({ contactId: "c-quote" }), verdict("qualified"));
  check(
    "opportunity a salesperson moved on: left alone, name kept",
    oppsOf("c-quote")[0]?.pipelineStageId === "st-quote" && oppsOf("c-quote")[0]?.name === "Kitchen job" && quote.finished?.action === "left",
    quote.finished,
  );

  const failing = makeEvent({ contactId: "c-fail" });
  const down = await run(failing, async () => {
    throw new Error("model down");
  });
  check(
    "qualifier down: opportunity stays in New Leads",
    oppsOf("c-fail")[0]?.pipelineStageId === "st-new" && down.finished?.action === "not_qualified",
    down.finished,
  );
  check("qualifier down: the note says why", notesOf("c-fail").some((x) => x.body.includes("model down")));
  check("qualifier down: a resend isn't redone", (await accept(failing)).kind === "duplicate");

  const noContact = await run(makeEvent({ contactId: null, from: "+447700900555" }), verdict("qualification_required"));
  const made = ghl.contacts.find((c) => c.phone === "+447700900555");
  check(
    "no contact id: contact created by phone, opportunity in Qualification Required",
    !!made && oppsOf(made.id)[0]?.pipelineStageId === "st-qr" && noContact.finished?.action === "moved",
    noContact.finished,
  );

  await saveClient(makeSettings({ services: [] }));
  const noServices = await run(makeEvent({ contactId: "c-noservices" }), verdict("qualification_required"));
  check(
    "no services saved: still sorted, note warns",
    noServices.finished?.action === "moved" && notesOf("c-noservices").some((x) => x.body.includes("No services")),
    notesOf("c-noservices"),
  );
  await saveClient(makeSettings());

  const salesStages = ghl.pipelines[0].stages;
  const qualifiedAt = salesStages.findIndex((s) => s.id === "st-q");
  const [qualifiedStage] = salesStages.splice(qualifiedAt, 1);
  const stageDeleted = await run(makeEvent({ contactId: "c-stagegone" }), verdict("qualified"));
  check(
    "chosen stage deleted in GoHighLevel: left in New Leads, note asks for it again",
    oppsOf("c-stagegone")[0]?.pipelineStageId === "st-new" &&
      stageDeleted.finished?.action === "not_qualified" &&
      notesOf("c-stagegone").some((x) => x.body.includes("Qualified")),
    stageDeleted.finished,
  );
  salesStages.splice(qualifiedAt, 0, qualifiedStage);

  const newLeadsAt = salesStages.findIndex((s) => s.id === "st-new");
  const [newLeadsStage] = salesStages.splice(newLeadsAt, 1);
  let refused = "";
  try {
    await accept(makeEvent({ contactId: "c-nostage" }), { classify: verdict("qualified") });
  } catch (e) {
    refused = e instanceof Error ? e.message : String(e);
  }
  check("New Leads stage gone: refused (Signal resends), nothing written", /New Leads/.test(refused) && oppsOf("c-nostage").length === 0, refused);
  salesStages.splice(newLeadsAt, 0, newLeadsStage);

  salesStages.push({ id: "st-lost", name: "Lost", position: 9 });
  await saveClient(makeSettings({ stages: { newLeads: "st-new", qualified: "st-q", qualificationRequired: "st-qr", lost: "st-lost" } }));
  await run(makeEvent({ contactId: "c-job" }), verdict("lost", { lostReason: "job_seeker" }));
  check(
    "with a Lost stage chosen: moved there and marked lost",
    oppsOf("c-job")[0]?.pipelineStageId === "st-lost" && oppsOf("c-job")[0]?.status === "lost",
    oppsOf("c-job")[0],
  );

  await run(makeEvent({ contactId: "c-dave" }), verdict("lost", { lostReason: "accounts_query" }));
  check(
    "qualified customer calling about an invoice isn't marked lost",
    oppsOf("c-dave")[0]?.status === "open" && oppsOf("c-dave")[0]?.pipelineStageId === "st-q",
    oppsOf("c-dave")[0],
  );

  const twin = makeEvent({ contactId: "c-twin" });
  const [x, y] = await Promise.all([
    accept(twin, { classify: verdict("qualified") }),
    accept(twin, { classify: verdict("qualified") }),
  ]);
  check("same call twice at once: one handled, one duplicate", [x.kind, y.kind].sort().join() === "accepted,duplicate", [x.kind, y.kind]);
  for (const r of [x, y]) if (r.kind === "accepted") await r.finish();
  check("same call twice at once: one opportunity, one note", oppsOf("c-twin").length === 1 && notesOf("c-twin").length === 1);

  section("Call-backs (fake Signal)");
  // The fake Signal checks call-back requests against the agency's own secret.
  const signal = await startFakeSignal({ secret: AGENCY.signalWebhookSecret });
  await saveClient(makeSettings({ callBacks: true }));
  const lastLine = (contactId: string) => notesOf(contactId).at(-1)?.body ?? "";

  await saveClient(makeSettings({ callBacks: true, callBackVoiceId: "v-m1" }));
  const hangUpCall = makeEvent({ contactId: "c-hangup", callBackUrl: signal.url });
  await run(hangUpCall, verdict("qualification_required", { decidedBy: "rule" }));
  check("hang-up: in Qualification Required", oppsOf("c-hangup")[0]?.pipelineStageId === "st-qr");
  check(
    "hang-up: Signal asked once, signed, for this call, reason hang_up",
    signal.requests.length === 1 &&
      signal.requests[0].signed &&
      signal.requests[0].callId === hangUpCall.call.id &&
      signal.requests[0].reason === "hang_up",
    signal.requests,
  );
  check(
    "the client's chosen voice goes with the request",
    signal.requests[0].voiceId === "v-m1",
    signal.requests[0],
  );
  await saveClient(makeSettings({ callBacks: true }));
  await run(makeEvent({ contactId: "c-novoice", callBackUrl: signal.url }), verdict("qualification_required"));
  check(
    "no voice chosen: Signal is left to choose",
    signal.requests.at(-1)?.voiceId === null,
    signal.requests.at(-1),
  );
  check(
    "hang-up: the note says when they'll be rung back",
    lastLine("c-hangup").includes("Call-back: the AI receptionist will ring them back in a minute or two."),
    lastLine("c-hangup"),
  );

  await run(makeEvent({ contactId: "c-unclear", callBackUrl: signal.url }), verdict("qualification_required"));
  check("unclear call: asked with reason unclear", signal.requests.at(-1)?.reason === "unclear", signal.requests.at(-1));

  const asked = signal.requests.length;
  await run(makeEvent({ contactId: "c-wants", callBackUrl: signal.url }), verdict("qualified"));
  check("qualified caller: Signal not asked", signal.requests.length === asked);
  await run(makeEvent({ contactId: "c-dave", callBackUrl: signal.url }), verdict("qualification_required"));
  check(
    "already qualified, rang again unclear: not asked, note says why",
    signal.requests.length === asked && lastLine("c-dave").includes("Call-back: not made. The opportunity is already further along"),
    lastLine("c-dave"),
  );

  signal.refuseNext = "They were already rung back in the last 24 hours.";
  await run(makeEvent({ contactId: "c-refused", callBackUrl: signal.url }), verdict("qualification_required"));
  check(
    "Signal refuses: its reason goes in the note",
    lastLine("c-refused").includes("Call-back: not made. They were already rung back in the last 24 hours."),
    lastLine("c-refused"),
  );

  await run(makeEvent({ contactId: "c-down", callBackUrl: "http://127.0.0.1:9/api/call-backs" }), verdict("qualification_required"));
  check(
    "Signal unreachable: still sorted, note says to ring them yourselves",
    oppsOf("c-down")[0]?.pipelineStageId === "st-qr" && lastLine("c-down").includes("Ring them back yourselves"),
    lastLine("c-down"),
  );

  const back = makeEvent({
    direction: "outbound",
    to: hangUpCall.call.fromNumber ?? undefined,
    contactId: "c-hangup",
    callBackOf: { callId: hangUpCall.call.id, reason: "hang_up" },
  });
  const backRun = await run(back, verdict("qualified"));
  check("call-back result: accepted, same opportunity", backRun.accepted.kind === "accepted" && !backRun.accepted.created && oppsOf("c-hangup").length === 1, backRun.accepted);
  check("call-back result: moved to Qualified", oppsOf("c-hangup")[0]?.pipelineStageId === "st-q", oppsOf("c-hangup")[0]);
  check(
    "call-back result: the note says it was a call-back, and asks for no other",
    lastLine("c-hangup").startsWith("The AI receptionist rang them back") && !lastLine("c-hangup").includes("Call-back:"),
    lastLine("c-hangup"),
  );

  const beforeVoicemail = signal.requests.length;
  const unansweredEvent = makeEvent({
    direction: "outbound",
    contactId: "c-unclear",
    callBackOf: { callId: "call-earlier", reason: "unclear" },
    endReason: "voicemail_reached",
    transcript: "User: Hi, you've reached Sam. Leave a message.",
  });
  const unanswered = await accept(unansweredEvent);
  const unansweredDone = unanswered.kind === "accepted" ? await unanswered.finish() : null;
  check(
    "call-back to voicemail: left in Qualification Required, no model, no new call-back",
    oppsOf("c-unclear")[0]?.pipelineStageId === "st-qr" &&
      unansweredDone?.action === "left" &&
      lastLine("c-unclear").includes("reached their voicemail") &&
      signal.requests.length === beforeVoicemail,
    { done: unansweredDone, note: lastLine("c-unclear") },
  );
  const offLine = await accept(
    makeEvent({ direction: "outbound", from: "+441223000000", contactId: "c-hangup", callBackOf: { callId: "x", reason: "hang_up" } }),
  );
  check("call-back from a number the client didn't choose: ignored", offLine.kind === "ignored", offLine);

  await saveClient(makeSettings({ callBacks: false }));
  const beforeOff = signal.requests.length;
  await run(makeEvent({ contactId: "c-off", callBackUrl: signal.url }), verdict("qualification_required"));
  check("call-backs off: Signal not asked, no call-back line", signal.requests.length === beforeOff && !lastLine("c-off").includes("Call-back"), lastLine("c-off"));
  signal.close();

  await deleteClient(FAKE_LOCATION);
  check("after disconnecting, calls are ignored", (await accept(makeEvent({ contactId: "c-after" }))).kind === "ignored");
  ghl.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

function makeSettings(over: Partial<ClientSettings> = {}): ClientSettings {
  const now = new Date().toISOString();
  return {
    version: 1,
    locationId: FAKE_LOCATION,
    businessName: "Hartley Plumbing & Heating",
    website: null,
    tokenEnc: encryptSecret(FAKE_TOKEN),
    numbers: ["+441223912555"],
    pipelineId: "p-sales",
    stages: { newLeads: "st-new", qualified: "st-q", qualificationRequired: "st-qr", lost: null },
    services: ["Boiler repairs", "Blocked drains", "Bathroom fitting"],
    connectedAt: now,
    updatedAt: now,
    ...over,
  };
}

let seq = 0;

function makeEvent(over: {
  direction?: "inbound" | "outbound";
  from?: string;
  to?: string;
  withheld?: boolean;
  contactId?: string | null;
  locationId?: string;
  callBackUrl?: string;
  callBackOf?: { callId: string; reason: string };
  endReason?: string;
  transcript?: string;
}): CallSyncedEvent {
  seq++;
  const now = new Date().toISOString();
  const direction = over.direction ?? "inbound";
  // The client's line is the number rung for a call in, the number rung from for a call-back.
  const line = (direction === "inbound" ? over.to : over.from) ?? "+441223912555";
  const customer = over.withheld
    ? null
    : ((direction === "inbound" ? over.from : over.to) ?? `+4477009${String(seq).padStart(5, "0")}`);
  return {
    event: "call.synced",
    version: 1,
    deliveryId: `delivery-${seq}`,
    sentAt: now,
    agency: { id: "agency-1", slug: "macaws", name: "Macaws AI" },
    client: { id: "client-1", name: "Hartley Plumbing" },
    call: {
      id: `call-${seq}-${Date.now()}`,
      platform: "retell",
      platformCallId: `rc_${seq}`,
      direction,
      startedAt: now,
      durationSec: 58,
      fromNumber: direction === "inbound" ? customer : line,
      toNumber: direction === "inbound" ? line : customer,
      agentPhoneNumber: line,
      callerName: null,
      summary: "A test call.",
      transcript: over.transcript ?? "Agent: Hello\nUser: My boiler is leaking",
      leadScreening: { outcome: "qualified", qualified: true },
      bookedAppointmentId: null,
      endReason: over.endReason ?? null,
      callBackOf: over.callBackOf ?? null,
    },
    ghl: {
      locationId: over.locationId ?? FAKE_LOCATION,
      contactId: over.contactId === undefined ? `contact-${seq}` : over.contactId,
    },
    callBackUrl: over.callBackUrl ?? null,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
