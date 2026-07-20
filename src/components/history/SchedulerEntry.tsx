import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { SchedulerJournalEntry } from "../../lib/backend-types";

export function SchedulerEntry({ entry }: { entry: SchedulerJournalEntry }) {
  return (
    <article>
      <div className="timeline-icon">
        <Icon name="schedule" />
      </div>
      <div>
        <h3>{copy("c356")}</h3>
        <p>
          {entry.kind === "missed" ? copy("c357") : copy("c358")} ·{" "}
          {entry.sourceId}
        </p>
      </div>
      <time>{new Date(entry.occurredAt).toLocaleString("fr-FR")}</time>
    </article>
  );
}
