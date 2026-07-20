import { useState } from "react";
import { copy } from "../i18n";
import { CustomFieldEditor } from "./CustomFieldEditor";
import { Icon } from "../components/Icon";
import { type Board, type CustomFieldValue, type Task } from "../lib/types";

export function TaskPanel({
  task,
  board,
  onClose,
  onChange,
  onMove,
  onArchive,
  onOpenFailure,
  onCancel,
  onCustom,
}: {
  task: Task;
  board: Board;
  onClose: () => void;
  onChange: (task: Task) => void;
  onMove: (id: string) => void;
  onArchive: () => void;
  onOpenFailure: () => void;
  onCancel: () => void;
  onCustom: (fieldId: string, value: CustomFieldValue) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const locked = typeof task.executionStatus === "object";
  return (
    <aside
      className="detail-panel"
      aria-label={copy("c304", { name: task.title })}
    >
      <header>
        <div>
          <span className="eyebrow">{copy("c027")}</span>
          <h2>{copy("c028")}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={copy("c029")}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        <label>
          {copy("c021")}

          <input
            disabled={locked}
            value={task.title}
            onChange={(event) =>
              onChange({ ...task, title: event.target.value })
            }
          />
        </label>
        <label>
          {copy("c030")}

          <textarea
            disabled={locked}
            rows={5}
            value={task.description}
            placeholder={copy("c031")}
            onChange={(event) =>
              onChange({ ...task, description: event.target.value })
            }
          />
        </label>
        <div className="field-grid">
          <label>
            {copy("c020")}

            <select
              disabled={locked}
              value={task.priority ?? "Normale"}
              onChange={(event) =>
                onChange({
                  ...task,
                  priority: event.target.value as Task["priority"],
                })
              }
            >
              <option>{copy("c032")}</option>
              <option>{copy("c033")}</option>
              <option>{copy("c034")}</option>
            </select>
          </label>
          <label>
            {copy("c035")}

            <input
              disabled={locked}
              type="date"
              value={task.dueDate ?? ""}
              onChange={(event) =>
                onChange({ ...task, dueDate: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          {copy("c036")}

          <input
            disabled={locked}
            value={task.tags.join(", ")}
            placeholder={copy("c037")}
            onChange={(event) =>
              onChange({
                ...task,
                tags: event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label>
          {copy("c038")}

          <textarea
            disabled={locked}
            rows={4}
            value={task.notes}
            onChange={(event) =>
              onChange({ ...task, notes: event.target.value })
            }
          />
        </label>
        {board.customFields.map((field) => (
          <CustomFieldEditor
            key={field.id}
            task={task}
            field={field}
            disabled={locked}
            onChange={(value) => onCustom(field.id, value)}
          />
        ))}
        {task.history.length > 0 && (
          <section className="history-snippet">
            <h3>{copy("c039")}</h3>
            <p>
              <Icon name="swap_horiz" />{" "}
              {new Date(task.history.at(-1)!.occurredAt).toLocaleString(
                "fr-FR",
              )}
            </p>
          </section>
        )}
        {task.executionStatus === "failed" && (
          <button className="inline-error action-link" onClick={onOpenFailure}>
            <Icon name="error" />
            {copy("c040")}
          </button>
        )}
        {typeof task.executionStatus === "object" && (
          <button className="secondary-button" onClick={onCancel}>
            <Icon name="stop_circle" />
            {copy("c041")}
          </button>
        )}
      </div>
      <footer>
        <div className="move-control">
          <button
            className="secondary-button"
            disabled={locked}
            onClick={() => setMoveOpen(!moveOpen)}
          >
            <Icon name="drive_file_move" />
            {copy("c042")}
          </button>
          {moveOpen && (
            <div className="move-menu" role="menu">
              {board.columns
                .filter((column) => column.id !== task.columnId)
                .map((column) => {
                  const allowed =
                    !board.transitionsRestricted ||
                    board.allowedTransitions.some(
                      (transition) =>
                        transition.fromColumnId === task.columnId &&
                        transition.toColumnId === column.id,
                    );
                  return (
                    <button
                      role="menuitem"
                      aria-disabled={!allowed}
                      disabled={locked || !allowed}
                      title={
                        allowed
                          ? undefined
                          : copy("c300", { name: column.name })
                      }
                      key={column.id}
                      onClick={() => {
                        onMove(column.id);
                        setMoveOpen(false);
                      }}
                    >
                      {column.name}
                      {!allowed && ` — ${copy("c301")}`}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
        <button
          className="text-button danger"
          disabled={locked}
          onClick={onArchive}
        >
          <Icon name="archive" />
          {copy("c043")}
        </button>
      </footer>
    </aside>
  );
}
