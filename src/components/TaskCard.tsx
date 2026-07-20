import { copy } from "../i18n";
import { customValueText } from "../lib/custom-values";
import { Icon } from "../components/Icon";
import { type Board, type Task } from "../lib/types";

export function TaskCard({
  task,
  pinnedFields,
  display,
  selected,
  onSelect,
  onReorder,
  canReorder,
  lastPosition,
}: {
  task: Task;
  pinnedFields: Board["customFields"];
  display: Board["cardDisplay"];
  selected: boolean;
  onSelect: () => void;
  onReorder: (position: number) => void;
  canReorder: boolean;
  lastPosition: number;
}) {
  const running =
    typeof task.executionStatus === "object"
      ? task.executionStatus.running
      : null;
  return (
    <article
      className={selected ? "task-card selected" : "task-card"}
      draggable={!running}
      onDragStart={(event) => {
        if (running) event.preventDefault();
        else event.dataTransfer.setData("text/task-id", task.id);
      }}
    >
      <button
        className="task-card-main"
        onClick={onSelect}
        aria-label={task.title}
      >
        <span className="task-title">{task.title}</span>
        {task.description && (
          <span className="task-description">{task.description}</span>
        )}
        <span className="task-meta">
          {display.priority && task.priority && (
            <span
              className={`priority-badge priority-${
                task.priority === "Haute"
                  ? "high"
                  : task.priority === "Basse"
                    ? "low"
                    : "mid"
              }`}
            >
              {task.priority}
            </span>
          )}
          {display.dueDate && task.dueDate && (
            <span className="due-date">
              <Icon name="event" />
              {new Date(task.dueDate).toLocaleDateString("fr-FR")}
            </span>
          )}
        </span>
        {display.tags && !!task.tags.length && (
          <span className="tag-row">
            {task.tags.slice(0, 3).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </span>
        )}
        {pinnedFields.map(
          (field) =>
            task.customValues[field.id] && (
              <span className="pinned-field" key={field.id}>
                <small>{field.name}</small>
                {customValueText(task.customValues[field.id])}
              </span>
            ),
        )}
        {display.source && task.sourceName && (
          <span className="source-badge">
            <Icon name="input_circle" />
            {task.sourceName}
          </span>
        )}
        {task.absentFromSource && (
          <span className="status-badge status-pending">
            <Icon name="link_off" />
            {copy("c026")}
          </span>
        )}
        {display.automationStatus && task.executionStatus !== "idle" && (
          <span
            className={`status-badge status-${typeof task.executionStatus === "string" ? task.executionStatus : "running"}`}
          >
            <Icon
              name={
                task.executionStatus === "failed"
                  ? "error"
                  : running
                    ? "sync"
                    : "check_circle"
              }
            />

            {task.executionStatus === "failed"
              ? copy("c257")
              : running
                ? copy("c259", { step: running.step, total: running.total })
                : copy("c258")}
          </span>
        )}
      </button>
      {canReorder && (
        <span className="card-order-actions">
          <button
            className="icon-button"
            aria-label={copy("c314", { name: task.title })}
            disabled={!!running || task.position === 0}
            onClick={() => onReorder(task.position - 1)}
          >
            <Icon name="arrow_upward" />
          </button>
          <button
            className="icon-button"
            aria-label={copy("c315", { name: task.title })}
            disabled={!!running || task.position >= lastPosition}
            onClick={() => onReorder(task.position + 1)}
          >
            <Icon name="arrow_downward" />
          </button>
        </span>
      )}
    </article>
  );
}
