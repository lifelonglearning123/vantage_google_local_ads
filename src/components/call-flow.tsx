import { STAGE_WHEN, type StageKind } from "@/lib/qualify/stages";
import { Icon, type IconName } from "./icons";

export type FlowStages = Record<StageKind, string | null>;

function Chip({ name, icon }: { name: string | null; icon?: IconName }) {
  return name ? (
    <span className="chip">
      {icon ? <Icon name={icon} size={16} /> : null}
      {name}
    </span>
  ) : (
    <span className="chip chip-empty">Choose a stage</span>
  );
}

function Warning({ text }: { text?: string | null }) {
  return text ? (
    <p className="flow-warning" role="note">
      <Icon name="attention" size={16} />
      {text}
    </p>
  ) : null;
}

/**
 * What happens to a call, in the pipeline's own stage names, so a stage chosen
 * for the wrong kind of call is easy to spot. Stages not chosen yet show as gaps.
 * The qualified lead carries the amber check, as in the brand book.
 */
export function CallFlow({
  stages,
  warnings = {},
  callBacks = false,
}: {
  stages: FlowStages;
  warnings?: Partial<Record<StageKind, string | null>>;
  /** The AI receptionist rings these callers back. */
  callBacks?: boolean;
}) {
  return (
    <ol className="flow">
      <li className="flow-step">
        <span className="flow-caption">
          <Icon name="phone" size={16} />A call comes in and lands in
        </span>
        <Chip name={stages.newLeads} />
      </li>
      <li className="flow-step">
        <span className="flow-caption">
          <Icon name="sparkle" size={16} className="ai" />
          Vantage AI reads the call, then moves it to
        </span>
        <ul className="lanes">
          <li className="lane lane-qualified">
            <span className="lane-when">{STAGE_WHEN.qualified}</span>
            <Chip name={stages.qualified} icon="live" />
            <Warning text={warnings.qualified} />
          </li>
          <li className="lane lane-contacted">
            <span className="lane-when">{STAGE_WHEN.qualificationRequired}</span>
            <Chip name={stages.qualificationRequired} />
            {callBacks ? (
              <span className="lane-then">
                <Icon name="phone" size={16} />
                The AI receptionist rings them back
              </span>
            ) : null}
          </li>
          <li className="lane lane-lost">
            <span className="lane-when">{STAGE_WHEN.lost}</span>
            {stages.lost ? <Chip name={stages.lost} icon="refused" /> : <Chip name="Marked Lost, left where it is" icon="refused" />}
            <Warning text={warnings.lost} />
          </li>
        </ul>
      </li>
    </ol>
  );
}
