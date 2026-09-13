"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { CallFlow } from "@/components/call-flow";
import { HelpButton } from "@/components/help-button";
import { Icon, type IconName } from "@/components/icons";
import type { Pipeline } from "@/lib/ghl";
import { formatPhone } from "@/lib/phone";
import { guessStage, STAGE_KINDS, stageNameWarning, type StageChoice, type StageKind } from "@/lib/qualify/stages";
import { draftServicesAction, saveSettingsAction, type SaveState, type SettingsTarget } from "./actions";

// Icons from the brand book's set: phone is a call lead, check is qualified, x is not a fit.
const ROWS: { kind: StageKind; label: string; lane: string; icon: IconName; optional?: boolean }[] = [
  { kind: "newLeads", label: "Every new call lands in", lane: "lane-new", icon: "phone" },
  { kind: "qualified", label: "Wants a service you offer", lane: "lane-qualified", icon: "live" },
  { kind: "qualificationRequired", label: "Not clear yet, or hung up", lane: "lane-contacted", icon: "waiting" },
  { kind: "lost", label: "Job seeker, sales call, spam or wrong number", lane: "lane-lost", icon: "refused", optional: true },
];

// Where the cursor goes when the save names a problem.
const FOCUS_ID = { numbers: "numbers", pipeline: "pipelineId", stages: "stage_newLeads", services: "services" } as const;
type Field = keyof typeof FOCUS_ID;

// When a request never gets a proper answer, the likeliest cause is a page left open while the
// app was updated or restarted: its buttons no longer match the server. A reload fixes it.
const SAVE_FAILED = "That save didn't go through. Reload the page, check the settings and save again.";
const DRAFT_FAILED = "Couldn't reach the app just now. Reload the page and try again.";

type Values = { numbers: string; services: string; pipelineId: string; stages: Record<StageKind, string> };
const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);

export function SettingsForm({
  target,
  pipelines,
  initial,
}: {
  target: SettingsTarget;
  pipelines: Pipeline[];
  initial: { numbers: string[]; pipelineId: string | null; stages: StageChoice; services: string[] };
}) {
  const agency = target.viewer === "agency";
  const their = agency ? "their" : "your";
  const savedPipeline = pipelines.find((p) => p.id === initial.pipelineId);

  // The saved stage when it's still in this pipeline, otherwise the stage whose name fits.
  const stagesFor = (pipelineId: string): Record<StageKind, string> => {
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    const picked = {} as Record<StageKind, string>;
    for (const kind of STAGE_KINDS) {
      const saved = pipelineId === initial.pipelineId ? initial.stages[kind] : null;
      picked[kind] =
        saved && pipeline?.stages.some((s) => s.id === saved) ? saved : pipeline ? (guessStage(pipeline.stages, kind) ?? "") : "";
    }
    return picked;
  };

  // What's actually stored, to tell unsaved changes apart (pre-selected stages count as unsaved).
  const [saved, setSaved] = useState<Values>(() => ({
    numbers: initial.numbers.map(formatPhone).join("\n"),
    services: initial.services.join("\n"),
    pipelineId: savedPipeline?.id ?? "",
    stages: Object.fromEntries(
      STAGE_KINDS.map((kind) => {
        const id = initial.stages[kind];
        return [kind, id && savedPipeline?.stages.some((s) => s.id === id) ? id : ""];
      }),
    ) as Record<StageKind, string>,
  }));
  const [start] = useState<Values>(() => {
    const pipelineId = savedPipeline?.id ?? pipelines[0]?.id ?? "";
    return { numbers: saved.numbers, services: saved.services, pipelineId, stages: stagesFor(pipelineId) };
  });
  const [values, setValues] = useState<Values>(start);
  const [resetTo, setResetTo] = useState<Values>(start);
  const dirty = !same(values, saved);

  const pipeline = pipelines.find((p) => p.id === values.pipelineId);
  const names = Object.fromEntries(
    STAGE_KINDS.map((kind) => [kind, pipeline?.stages.find((s) => s.id === values.stages[kind])?.name ?? null]),
  ) as Record<StageKind, string | null>;
  const warnings = Object.fromEntries(
    STAGE_KINDS.map((kind) => [kind, names[kind] ? stageNameWarning(kind, names[kind]) : null]),
  ) as Record<StageKind, string | null>;

  const [saving, startSaving] = useTransition();
  const [result, setResult] = useState<SaveState>(null);
  const [drafting, startDrafting] = useTransition();
  const [draftNote, setDraftNote] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (result && !result.ok && result.field) document.getElementById(FOCUS_ID[result.field])?.focus();
  }, [result]);

  const errorFor = (field: Field) => (result && !result.ok && result.field === field ? result.message : null);
  const numbersError = errorFor("numbers");
  const pipelineError = errorFor("pipeline");
  const stagesError = errorFor("stages");

  const suggestServices = () =>
    startDrafting(async () => {
      setDraftNote(null);
      try {
        const draft = await draftServicesAction(target);
        if (draft.ok) {
          setValues((v) => ({ ...v, services: draft.services.join("\n") }));
          setDraftNote({ ok: true, message: `Found ${draft.services.length} services on the website. Check them, then save.` });
        } else {
          setDraftNote({ ok: false, message: draft.message });
        }
      } catch (error) {
        unstable_rethrow(error);
        setDraftNote({ ok: false, message: DRAFT_FAILED });
      }
    });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const submitted = values;
    startSaving(async () => {
      try {
        const response = await saveSettingsAction(target, data);
        setResult(response);
        if (response?.ok && response.saved) {
          // Show numbers and services the way they were stored.
          const next: Values = {
            ...submitted,
            numbers: response.saved.numbers.map(formatPhone).join("\n"),
            services: response.saved.services.join("\n"),
          };
          setSaved(next);
          setResetTo(next);
          setValues((current) => (same(current, submitted) ? next : current));
        }
      } catch (error) {
        // A redirect (say, an expired session) must still happen; anything else becomes a message.
        unstable_rethrow(error);
        setResult({ ok: false, message: SAVE_FAILED });
      }
    });
  };

  let saveText;
  if (saving) saveText = "Saving…";
  else if (result && !result.ok)
    saveText = (
      <span className="status-line status-error">
        <Icon name="attention" size={18} />
        {result.message}
      </span>
    );
  else if (dirty) saveText = "You have unsaved changes";
  else if (result?.ok)
    saveText = (
      <span className="status-line status-ok">
        <Icon name="live" size={18} />
        {result.message}
      </span>
    );
  else saveText = <span className="muted">Everything&apos;s saved</span>;

  return (
    <form method="post" onSubmit={submit} className="settings-grid" noValidate>
      <div>
        <div className="panel">
          <section className="setup-section" id="setup-numbers" aria-labelledby="numbers-title">
            <div className="section-head">
              <span className="step" aria-hidden>
                01
              </span>
              <h2 id="numbers-title">Signal number</h2>
              <p>Only calls to this number are sorted. Calls {their} team makes are left alone.</p>
              <HelpButton chapter="signal-number" />
            </div>
            <div className="field">
              <label htmlFor="numbers">The number customers ring</label>
              <textarea
                id="numbers"
                name="numbers"
                className="num"
                rows={2}
                style={{ minHeight: 84 }}
                value={values.numbers}
                onChange={(e) => setValues((v) => ({ ...v, numbers: e.target.value }))}
                placeholder="01223 912555"
                aria-invalid={numbersError ? true : undefined}
                aria-describedby={numbersError ? "numbers-error" : "numbers-hint"}
              />
              {numbersError ? (
                <p id="numbers-error" className="field-error">
                  <Icon name="attention" size={18} />
                  {numbersError}
                </p>
              ) : (
                <p id="numbers-hint" className="hint">
                  More than one? Put each on its own line.
                </p>
              )}
            </div>
          </section>

          <section className="setup-section" aria-labelledby="stages-title">
            <div className="section-head">
              <span className="step" aria-hidden>
                02
              </span>
              <h2 id="stages-title">Where calls go</h2>
              <p>{agency ? "Their" : "Your"} pipeline and stages, straight from Nexus Portal.</p>
              <HelpButton chapter="pipeline" />
            </div>
            {pipelines.length === 0 ? (
              <div className="alert alert-warn" role="alert">
                <Icon name="attention" size={18} />
                <span>This sub-account has no pipelines yet. Create one in Nexus Portal, then reload this page.</span>
              </div>
            ) : (
              <>
                <div className="field" id="setup-pipeline">
                  <label htmlFor="pipelineId">Pipeline</label>
                  <select
                    id="pipelineId"
                    name="pipelineId"
                    value={values.pipelineId}
                    onChange={(e) => {
                      const pipelineId = e.target.value;
                      setValues((v) => ({ ...v, pipelineId, stages: stagesFor(pipelineId) }));
                    }}
                    aria-invalid={pipelineError ? true : undefined}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {pipelineError ? (
                    <p className="field-error">
                      <Icon name="attention" size={18} />
                      {pipelineError}
                    </p>
                  ) : null}
                </div>

                <div className="stage-rows field" id="setup-stages" role="group" aria-labelledby="stage-rows-label">
                  <p id="stage-rows-label" className="field-label">
                    Which stage each kind of call goes to
                  </p>
                  {ROWS.map((row) => (
                    <div key={row.kind} className={`stage-row ${row.lane}`}>
                      <span className="stage-icon" aria-hidden>
                        <Icon name={row.icon} size={18} />
                      </span>
                      <label htmlFor={`stage_${row.kind}`}>
                        {row.label}
                        {row.optional ? <span className="muted"> (optional)</span> : null}
                      </label>
                      <select
                        id={`stage_${row.kind}`}
                        name={`stage_${row.kind}`}
                        value={values.stages[row.kind]}
                        onChange={(e) => {
                          const id = e.target.value;
                          setValues((v) => ({ ...v, stages: { ...v.stages, [row.kind]: id } }));
                        }}
                        aria-invalid={stagesError ? true : undefined}
                      >
                        <option value="">{row.optional ? "Leave where it is, marked Lost" : "Choose a stage…"}</option>
                        {(pipeline?.stages ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {warnings[row.kind] ? (
                        <p className="stage-warning">
                          <Icon name="attention" size={16} />
                          {warnings[row.kind]}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {stagesError ? (
                    <p className="field-error">
                      <Icon name="attention" size={18} />
                      {stagesError}
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </section>

          <section className="setup-section" id="setup-services" aria-labelledby="services-title">
            <div className="section-head">
              <span className="step" aria-hidden>
                03
              </span>
              <h2 id="services-title">Services {agency ? "they" : "you"} offer</h2>
              <p>
                Callers asking for one of these go to {names.qualified ? `“${names.qualified}”` : "the Qualified stage"}. It
                matches by meaning, so &ldquo;my boiler&apos;s leaking&rdquo; matches &ldquo;Boiler repairs&rdquo;.
              </p>
              <HelpButton chapter="services" />
            </div>
            <div className="field">
              <label htmlFor="services">Services, one per line</label>
              <textarea
                id="services"
                name="services"
                rows={8}
                value={values.services}
                onChange={(e) => setValues((v) => ({ ...v, services: e.target.value }))}
                placeholder={"Boiler repairs\nBlocked drains\nBathroom fitting"}
              />
            </div>
            <div className="inline-actions">
              <button type="button" className="btn btn-secondary" onClick={suggestServices} disabled={drafting}>
                <Icon name="globe" size={18} />
                {drafting ? "Reading the website…" : "Suggest from website"}
              </button>
              {draftNote ? (
                <span role="status" className={`status-line ${draftNote.ok ? "status-ok" : "status-error"}`}>
                  {draftNote.message}
                </span>
              ) : null}
            </div>
          </section>
        </div>

        <div className={`savebar${dirty ? " on-ink" : ""}`} data-dirty={dirty}>
          <span className="savebar-text" role="status">
            {saveText}
          </span>
          <span className="savebar-actions">
            {!saving && !same(values, resetTo) ? (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setValues(resetTo);
                  setResult(null);
                }}
              >
                Discard
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={saving || pipelines.length === 0}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </span>
        </div>
      </div>

      <aside className="sorting on-ink" aria-labelledby="flow-title">
        <h2 id="flow-title">What happens to each call</h2>
        <p>Using the stages chosen here. It changes as you pick.</p>
        <HelpButton chapter="calls" label="Watch what happens to a call" />
        <CallFlow stages={names} warnings={warnings} />
        <p className="flow-note">
          Someone who rings again keeps the same opportunity. It only ever moves forward, and once {their} team moves it
          on, it&apos;s left alone. Each call adds a note to the contact saying why.
        </p>
      </aside>
    </form>
  );
}
