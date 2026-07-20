import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { Board, Task } from "../../lib/types";

export function TransitionEntry({
  board,
  task,
  history,
}: {
  board: Board;
  task: Task;
  history: Task["history"][number];
}) {
  return (
    <article>
      <div className="timeline-icon">
        <Icon name="swap_horiz" />
      </div>
      <div>
        <h3>{task.title}</h3>
        <p>
          {copy("c171")}{" "}
          {
            board.columns.find((column) => column.id === history.toColumnId)
              ?.name
          }{" "}
          · {board.name}
        </p>
      </div>
      <time>{new Date(history.occurredAt).toLocaleString("fr-FR")}</time>
    </article>
  );
}
