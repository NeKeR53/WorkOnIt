import { useMemo, useState } from "react";
import { copy } from "../i18n";
import { customValueText } from "../lib/custom-values";
import { TaskCard } from "./TaskCard";
import { Icon } from "../components/Icon";
import { type Board } from "../lib/types";

export function BoardView({
  board,
  search,
  selectedTaskId,
  onSelectTask,
  onAddTask,
  onMoveTask,
  onReorderTask,
  onConfigureColumn,
}: {
  board: Board;
  search: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onAddTask: (columnId: string) => void;
  onMoveTask: (taskId: string, columnId: string) => void;
  onReorderTask: (taskId: string, position: number) => void;
  onConfigureColumn: (columnId: string) => void;
}) {
  const [columnSorts, setColumnSorts] = useState<Record<string, string>>({});
  const filtered = useMemo(
    () =>
      board.tasks.filter(
        (task) =>
          !task.archived &&
          `${task.title} ${task.description} ${task.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [board.tasks, search],
  );
  return (
    <section
      className="board-scroll"
      aria-label={copy("c311", { name: board.name })}
    >
      <div className="board-grid">
        {[...board.columns]
          .sort((a, b) => a.position - b.position)
          .map((column) => {
            const sort = columnSorts[column.id] ?? "manual";
            const tasks = filtered
              .filter((task) => task.columnId === column.id)
              .sort((a, b) => {
                if (sort === "title") return a.title.localeCompare(b.title);
                if (sort === "date")
                  return b.updatedAt.localeCompare(a.updatedAt);
                if (sort === "priority")
                  return (
                    { Haute: 0, Normale: 1, Basse: 2 }[
                      a.priority ?? "Normale"
                    ] -
                    { Haute: 0, Normale: 1, Basse: 2 }[b.priority ?? "Normale"]
                  );

                if (sort.startsWith("field:"))
                  return customValueText(
                    a.customValues[sort.slice(6)] ?? {
                      kind: "text",
                      value: "",
                    },
                  ).localeCompare(
                    customValueText(
                      b.customValues[sort.slice(6)] ?? {
                        kind: "text",
                        value: "",
                      },
                    ),
                  );
                return a.position - b.position;
              });
            const warning =
              column.wipPolicy.kind !== "none" &&
              tasks.length >= column.wipPolicy.limit;
            return (
              <section
                className="kanban-column"
                key={column.id}
                role="region"
                aria-label={column.name}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) =>
                  onMoveTask(
                    event.dataTransfer.getData("text/task-id"),
                    column.id,
                  )
                }
              >
                <header
                  className="column-header"
                  style={
                    { "--column-color": column.color } as React.CSSProperties
                  }
                >
                  <div>
                    <h2>{column.name}</h2>
                    <span className="count-badge">{tasks.length}</span>
                  </div>
                  <div className="column-header-actions">
                    <label className="column-sort" title={copy("c022")}>
                      <Icon name="sort" />
                      <span className="sr-only">
                        {copy("c017")} — {column.name}
                      </span>
                      <select
                        aria-label={`${copy("c017")} — ${column.name}`}
                        value={sort}
                        onChange={(event) =>
                          setColumnSorts((current) => ({
                            ...current,
                            [column.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="manual">{copy("c018")}</option>
                        <option value="date">{copy("c019")}</option>
                        <option value="priority">{copy("c020")}</option>
                        <option value="title">{copy("c021")}</option>
                        {board.customFields.map((field) => (
                          <option key={field.id} value={`field:${field.id}`}>
                            {field.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="icon-button"
                      aria-label={copy("c302", { name: column.name })}
                      onClick={() => onConfigureColumn(column.id)}
                    >
                      <Icon name="more_horiz" />
                    </button>
                  </div>
                </header>
                {warning && (
                  <p className="wip-warning">
                    <Icon name="warning" />
                    {copy("c023")}{" "}
                    {column.wipPolicy.kind === "hard"
                      ? copy("c256")
                      : copy("c255")}
                  </p>
                )}
                <div className="card-list">
                  {tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      pinnedFields={board.customFields
                        .filter((field) => field.pinned)
                        .slice(0, 3)}
                      display={board.cardDisplay}
                      selected={selectedTaskId === task.id}
                      onSelect={() => onSelectTask(task.id)}
                      onReorder={(position) => onReorderTask(task.id, position)}
                      canReorder={sort === "manual"}
                      lastPosition={tasks.length - 1}
                    />
                  ))}
                  {!tasks.length && (
                    <div className="column-empty">
                      <Icon name="inbox" />
                      <span>{copy("c024")}</span>
                    </div>
                  )}
                </div>
                <button
                  className="add-task-button"
                  aria-label={copy("c303", { name: column.name })}
                  onClick={() => onAddTask(column.id)}
                >
                  <Icon name="add" />
                  {copy("c025")}
                </button>
              </section>
            );
          })}
      </div>
    </section>
  );
}
