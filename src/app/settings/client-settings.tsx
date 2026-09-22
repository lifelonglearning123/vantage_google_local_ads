import { HelpButton } from "@/components/help-button";
import { Icon } from "@/components/icons";
import { agencyOf } from "@/lib/agencies";
import type { ClientSettings } from "@/lib/clients";
import { formatPhone } from "@/lib/phone";
import { checkClient } from "@/lib/qualify/config";
import { listCallBackVoices } from "@/lib/qualify/voices";
import type { SettingsTarget, Viewer } from "./actions";
import { DisconnectForm } from "./disconnect-form";
import { SettingsForm } from "./settings-form";

/** One client's settings: for the client at /settings, and for the agency at /agency/clients/<location ID>. */
export async function ClientSettingsView({ client, viewer }: { client: ClientSettings; viewer: Viewer }) {
  const target: SettingsTarget = { viewer, locationId: client.locationId };
  const agency = viewer === "agency";
  // Live, so a stage added or renamed in GoHighLevel shows up on reload.
  const [{ pipelines, pipeline, issues, ghlError }, voices] = await Promise.all([
    checkClient(client),
    // Signal holds the telephony keys, so the voices come from there: the
    // Signal workspace of the agency this client belongs to. Null when it
    // can't be reached: the client keeps the automatic voice.
    listCallBackVoices(client.locationId, agencyOf(client)?.signalWebhookSecret ?? null),
  ]);
  const todo = issues.filter((issue, i) => issues.findIndex((other) => other.text === issue.text) === i);

  return (
    <>
      {ghlError ? (
        <section className="status-panel status-broken" role="alert" aria-labelledby="status-title">
          <span className="status-icon">
            <Icon name="refused" size={30} />
          </span>
          <h2 id="status-title">Nexus Portal won&apos;t accept the saved token</h2>
          <p className="muted">{ghlError}</p>
          <p>
            {agency
              ? "Add the client again from All clients, with a new token."
              : "Sign out, then connect again with a new token."}
          </p>
          <HelpButton chapter="add-client" label="Watch how to reconnect" />
        </section>
      ) : todo.length === 0 ? (
        <section className="status-panel status-live" aria-labelledby="status-title">
          <span className="status-icon">
            <Icon name="live" size={30} />
          </span>
          <h2 id="status-title">Live</h2>
          <p>
            Calls to <strong className="num">{client.numbers.map(formatPhone).join(", ")}</strong> are being sorted into
            the &ldquo;{pipeline?.name}&rdquo; pipeline.
          </p>
        </section>
      ) : (
        <section className="status-panel status-todo" aria-labelledby="status-title">
          <span className="status-icon">
            <Icon name="attention" size={30} />
          </span>
          <h2 id="status-title">Not live yet</h2>
          <p>{todo.length === 1 ? "One thing to finish" : `${todo.length} things to finish`} before calls are sorted:</p>
          <ul className="todo-list">
            {todo.map((issue) => (
              <li key={issue.text}>
                <a href={`#setup-${issue.field}`}>
                  {issue.text}
                  <Icon name="arrowRight" size={16} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Keyed by client: moving between clients must never carry one client's typed settings into another's form. */}
      {ghlError ? null : (
        <SettingsForm
          key={`settings-${client.locationId}`}
          target={target}
          pipelines={pipelines}
          initial={{
            numbers: client.numbers,
            pipelineId: client.pipelineId,
            stages: client.stages,
            services: client.services,
            callBacks: client.callBacks === true,
            callBackVoiceId: client.callBackVoiceId ?? "",
          }}
          voices={voices}
        />
      )}

      <DisconnectForm key={`disconnect-${client.locationId}`} target={target} />
    </>
  );
}
