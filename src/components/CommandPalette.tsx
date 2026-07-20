import { useEffect, useState } from "react";
import { copy } from "../i18n";
import { Icon } from "../components/Icon";
import { loadActions, loadSources } from "../lib/repository";
import { type Board, type Page, type Task } from "../lib/types";
import type { CommandAction, SourceDefinition } from "../lib/backend-types";

export function CommandPalette({
  boards,
  onClose,
  onOpen,
}: {
  boards: Board[];
  onClose: () => void;
  onOpen: (page: Page, board?: Board, task?: Task) => void;
}) {
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<CommandAction[]>([]);
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  useEffect(() => {
    void loadActions().then(setActions);
    void loadSources().then(setSources);
  }, []);
  const results: Array<{
    board?: Board;
    task?: Task;
    label: string;
    kind: string;
    page: Page;
  }> = [
    ...boards
      .flatMap((board) => [
        { board, task: undefined, label: board.name, kind: copy("c266") },
        ...board.tasks
          .filter((task) => !task.archived)
          .map((task) => ({
            board,
            task,
            label: task.title,
            kind: copy("c267"),
          })),
      ])
      .map((result) => ({ ...result, page: "boards" as const })),
    ...actions.map((action) => ({
      label: action.name,
      kind: copy("c268"),
      page: "automations" as const,
    })),
    ...sources.map((source) => ({
      label: source.name,
      kind: copy("c269"),
      page: "sources" as const,
    })),
  ]
    .filter((result) =>
      result.label.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 12);
  return (
    <div className="dialog-backdrop">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={copy("c053")}
      >
        <label>
          <Icon name="search" />
          <span className="sr-only">{copy("c054")}</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy("c055")}
          />

          <button className="key-button" onClick={onClose}>
            {copy("c056")}
          </button>
        </label>
        <div className="palette-results">
          {results.map((result) => (
            <button
              key={`${result.kind}-${result.label}`}
              onClick={() => onOpen(result.page, result.board, result.task)}
            >
              <span>
                <Icon
                  name={
                    result.kind === copy("c266")
                      ? "view_kanban"
                      : result.kind === copy("c267")
                        ? "task_alt"
                        : result.kind === copy("c268")
                          ? "terminal"
                          : "input_circle"
                  }
                />

                {result.label}
              </span>
              <small>
                {result.kind}
                {result.board ? ` · ${result.board.name}` : ""}
              </small>
            </button>
          ))}
          {!results.length && <p>{copy("c057")}</p>}
        </div>
      </div>
    </div>
  );
}
