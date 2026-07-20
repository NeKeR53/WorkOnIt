import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { Board, Task } from "../../lib/types";

export function ArchivedTaskItem({
  board,
  task,
  onRestore,
  onDeleteRequest,
}: {
  board: Board;
  task: Task;
  onRestore: () => void;
  onDeleteRequest: () => void;
}) {
  return (
    <article>
      <div>
        <strong>{task.title}</strong>
        <small>{board.name}</small>
      </div>
      <button className="secondary-button" onClick={onRestore}>
        <Icon name="unarchive" />
        {copy("c214")}
      </button>
      <button className="text-button danger" onClick={onDeleteRequest}>
        <Icon name="delete_forever" />
        {copy("c215")}
      </button>
    </article>
  );
}
