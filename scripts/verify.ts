import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deleteClient, listClients, readClient, saveClient, type ClientSettings } from "@/lib/clients";
import { connectClient } from "@/lib/connect";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Pipeline } from "@/lib/ghl";
import { normalizePhone, parsePhoneList } from "@/lib/phone";
import { findService, nothingFromCaller, settleVerdict, type ModelVerdict } from "@/lib/qualify/classify";
import { callIsOnNumbers, resolveConfig } from "@/lib/qualify/config";
import { planOpportunity, type OpportunityPlan, type StageIds } from "@/lib/qualify/decide";
import { htmlToText } from "@/lib/qualify/draft-services";
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
  check("'null' caller name cleaned up", settleVerdict({ ...base, caller_name: "null" }, services, "m").callerName === null);
  check("unrelated service doesn't match", findService("Electrical rewiring", services) === null);
  check("agent-only transcript needs no model", nothingFromCaller({ transcript: "Agent: Hello, how can I help?", summary: "Silent." }));
  check("caller speech goes to the model", !nothingFromCaller({ transcript: "Agent: Hello\nUser: My drain's blocked", summary: null }));
  check("unlabelled text goes to the model", !nothingFromCaller({ transcript: "my drain is blocked", summary: null }));
  check("no transcript or summary needs no model", nothingFromCaller({ transcript: null, summary: null }));

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
  check("a chosen number matches however it's written", callIsOnNumbers(["+441223912555"], { toNumber: "01223 912555", agentPhoneNumber: null }));
  check("other numbers don't match", !callIsOnNumbers(["+441223912555"], { toNumber: "+441223000000", agentPhoneNumber: "+441223000000" }));
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
  const agencyCookie = encodeAgencySession(login, sessionSecret, 1_000);
  check("agency session accepted", isAgencySession(agencyCookie, login, sessionSecret, 2_000));
  check(
    "changing the agency password signs the agency out",
    !isAgencySession(agencyCookie, { ...login, password: "a brand new password" }, sessionSecret, 2_000),
  );
  check("expired agency session refused", !isAgencySession(agencyCookie, login, sessionSecret, 1_000 + 8 * 24 * 3600 * 1000));
  const agencyTampered = agencyCookie.slice(0, -1) + (agencyCookie.endsWith("A") ? "B" : "A");
  check("tampered agency session refused", !isAgencySession(agencyTampered, login, sessionSecret, 2_000));
  check("a client's session doesn't pass as the agency's", !isAgencySession(cookie, login, sessionSecret, 2_000));
  check("the agency's session doesn't pass as a client's", decodeSession(agencyCookie, sessionSecret, 2_000) === null);
  check("no session secret → no agency session", !isAgencySession(agencyCookie, login, "", 2_000));
  check("right username and password match", loginMatches(login, "agency", "correct horse battery"));
  check("wrong password doesn't match", !loginMatches(login, "agency", "correct horse batter"));
  check("wrong username doesn't match", !loginMatches(login, "Agency", "correct horse battery"));

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
  const listed = (await listClients()).map((c) => c.locationId);
  check("every client listed by business name, other files ignored", listed.join() === "loc2,loc1", listed);
  await deleteClient("loc2");
  await deleteClient(FAKE_LOCATION);
  check(
    "disconnected settings are gone, and off the list",
    (await readClient(FAKE_LOCATION)) === null && (await listClients()).length === 0,
  );

  section("Connecting a sub-account (fake GoHighLevel)");
  const ghl = await startFakeGhl();
  process.env.GHL_API_BASE = ghl.url;
  const wrongToken = await connectClient(FAKE_LOCATION, "pit-wrong-token");
  check(
    "wrong token: GoHighLevel's reason, nothing saved",
    !wrongToken.ok && /refused/i.test(wrongToken.error) && (await readClient(FAKE_LOCATION)) === null,
    wrongToken,
  );
  const askedBefore = ghl.log.length;
  const oddId = await connectClient("../loc1", FAKE_TOKEN);
  check("odd location ID refused before GoHighLevel is asked", !oddId.ok && ghl.log.length === askedBefore, oddId);
  const connected = await connectClient(FAKE_LOCATION, FAKE_TOKEN);
  check(
    "right token: saved with the business name, nothing chosen yet",
    connected.ok &&
      connected.settings.businessName === "Hartley Plumbing & Heating" &&
      (await readClient(FAKE_LOCATION))?.pipelineId === null,
    connected,
  );
  await saveClient(makeSettings());
  const reconnected = await connectClient(FAKE_LOCATION, FAKE_TOKEN);
  check(
    "connecting again keeps the chosen settings",
    reconnected.ok && reconnected.settings.pipelineId === "p-sales" && reconnected.settings.services.length === 3,
    reconnected,
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
    const accepted = await acceptCall(e, { classify });
    const finished = accepted.kind === "accepted" ? await accepted.finish() : null;
    return { accepted, finished };
  };
  const oppsOf = (contactId: string | undefined) => ghl.opps.filter((o) => o.contactId === contactId);
  const notesOf = (contactId: string) => ghl.notes.filter((x) => x.contactId === contactId);

  check("outbound call ignored", (await acceptCall(makeEvent({ direction: "outbound" }))).kind === "ignored");
  check("sub-account that isn't connected: ignored", (await acceptCall(makeEvent({ locationId: "loc2" }))).kind === "ignored");
  const offList = await acceptCall(makeEvent({ contactId: "c-offlist", to: "+441223000000" }), { classify: verdict("qualified") });
  check("call to a number the client didn't choose: ignored", offList.kind === "ignored", offList);
  check("ignored calls never reach GoHighLevel", ghl.log.length === 0, ghl.log);

  const first = makeEvent({ contactId: "c-dave" });
  const a1 = await acceptCall(first, { classify: verdict("qualified") });
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
  check("same call sent again → duplicate", (await acceptCall(first)).kind === "duplicate");
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
  check("qualifier down: a resend isn't redone", (await acceptCall(failing)).kind === "duplicate");

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
    await acceptCall(makeEvent({ contactId: "c-nostage" }), { classify: verdict("qualified") });
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
    acceptCall(twin, { classify: verdict("qualified") }),
    acceptCall(twin, { classify: verdict("qualified") }),
  ]);
  check("same call twice at once: one handled, one duplicate", [x.kind, y.kind].sort().join() === "accepted,duplicate", [x.kind, y.kind]);
  for (const r of [x, y]) if (r.kind === "accepted") await r.finish();
  check("same call twice at once: one opportunity, one note", oppsOf("c-twin").length === 1 && notesOf("c-twin").length === 1);

  await deleteClient(FAKE_LOCATION);
  check("after disconnecting, calls are ignored", (await acceptCall(makeEvent({ contactId: "c-after" }))).kind === "ignored");
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
  contactId?: string | null;
  locationId?: string;
}): CallSyncedEvent {
  seq++;
  const now = new Date().toISOString();
  const line = over.to ?? "+441223912555";
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
      direction: over.direction ?? "inbound",
      startedAt: now,
      durationSec: 58,
      fromNumber: over.from ?? `+4477009${String(seq).padStart(5, "0")}`,
      toNumber: line,
      agentPhoneNumber: line,
      callerName: null,
      summary: "A test call.",
      transcript: "Agent: Hello\nUser: My boiler is leaking",
      leadScreening: { outcome: "qualified", qualified: true },
      bookedAppointmentId: null,
    },
    ghl: {
      locationId: over.locationId ?? FAKE_LOCATION,
      contactId: over.contactId === undefined ? `contact-${seq}` : over.contactId,
    },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
