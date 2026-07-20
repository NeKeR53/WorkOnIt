import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { ExecutionRecord } from "../../lib/backend-types";

export function ExecutionRow({
  execution,
  taskTitle,
  onSelect,
}: {
  execution: ExecutionRecord;
  taskTitle: string | undefined;
  onSelect: () => void;
}) {
  return (
    <button className="execution-row" onClick={onSelect}>
      <span
        className={`timeline-icon status-${typeof execution.status === "string" ? execution.status : "running"}`}
      >
        <Icon name={execution.status === "failed" ? "error" : "terminal"} />
      </span>
      <span>
        <strong>{taskTitle ?? copy("c308")}</strong>
        <small>
          {execution.steps.length}
          {copy("c170")}{" "}
          {typeof execution.status === "string" ? execution.status : "en cours"}
        </small>
      </span>
      <time>{new Date(execution.startedAt).toLocaleString("fr-FR")}</time>
    </button>
  );
}
