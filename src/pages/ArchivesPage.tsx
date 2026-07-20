import { useState } from "react";
import { copy } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { ArchivedTaskItem } from "../components/archives/ArchivedTaskItem";
import { DeleteTaskConfirm } from "../components/archives/DeleteTaskConfirm";
import {
  deleteTaskPermanently,
  restoreTaskInRepository,
} from "../lib/repository";
import { type Board } from "../lib/types";

export function ArchivesPage({
  boards,
  onBoards,
  onMessage,
}: {
  boards: Board[];
  onBoards: (boards: Board[]) => void;
  onMessage: (message: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<{
    boardId: string;
    taskId: string;
  } | null>(null);
  const archived = boards.flatMap((board) =>
    board.tasks
      .filter((task) => task.archived)
      .map((task) => ({ board, task })),
  );
  const replace = (updated: Board) =>
    onBoards(
      boards.map((board) => (board.id === updated.id ? updated : board)),
    );
  return (
    <>
      <PageHeader title={copy("c005")} description={copy("c212")} />
      <section className="content-page archives-page" aria-label={copy("c005")}>
        <div className="archive-list">
          {archived.map(({ board, task }) => (
            <ArchivedTaskItem
              key={task.id}
              board={board}
              task={task}
              onRestore={() =>
                void restoreTaskInRepository(board.id, task.id).then(
                  (updated) => {
                    replace(updated);
                    onMessage(copy("c287"));
                  },
                )
              }
              onDeleteRequest={() =>
                setConfirmDelete({ boardId: board.id, taskId: task.id })
              }
            />
          ))}
          {!archived.length && (
            <div className="pane-empty">
              <Icon name="inventory_2" />
              <p>{copy("c216")}</p>
            </div>
          )}
        </div>
        {confirmDelete && (
          <DeleteTaskConfirm
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() =>
              void deleteTaskPermanently(
                confirmDelete.boardId,
                confirmDelete.taskId,
              ).then((updated) => {
                replace(updated);
                setConfirmDelete(null);
                onMessage(copy("c288"));
              })
            }
          />
        )}
      </section>
    </>
  );
}
