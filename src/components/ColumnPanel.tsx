import { useEffect, useState } from "react";
import { copy } from "../i18n";
import { Icon } from "../components/Icon";
import {
  configureColumnInRepository,
  deleteColumnInRepository,
  loadAutomationDrafts,
} from "../lib/repository";
import { type Board, type WipPolicy } from "../lib/types";
import type { AutomationDraft } from "../lib/backend-types";

export function ColumnPanel({
  board,
  columnId,
  onBoard,
  onClose,
  onMessage,
}: {
  board: Board;
  columnId: string;
  onBoard: (board: Board) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const column = board.columns.find((candidate) => candidate.id === columnId)!;
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color);
  const [wipKind, setWipKind] = useState(column.wipPolicy.kind);
  const [limit, setLimit] = useState(
    column.wipPolicy.kind === "none" ? 5 : column.wipPolicy.limit,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [automationDrafts, setAutomationDrafts] = useState<AutomationDraft[]>(
    [],
  );
  const [destinationId, setDestinationId] = useState(
    board.columns.find((candidate) => candidate.id !== columnId)?.id ?? "",
  );
  const affectedTasks = board.tasks.filter(
    (task) => task.columnId === columnId && !task.archived,
  );
  const affectedAutomations = automationDrafts.filter((automation) => {
    const definitions = [automation.draft, automation.active].filter(
      (definition) => definition !== undefined,
    );
    return definitions.some(
      (definition) =>
        definition.fromColumnId === columnId ||
        definition.toColumnId === columnId,
    );
  });
  useEffect(() => {
    void loadAutomationDrafts(board.id).then(setAutomationDrafts);
  }, [board.id]);
  const saveColumn = () => {
    const wipPolicy: WipPolicy =
      wipKind === "none" ? { kind: "none" } : { kind: wipKind, limit };
    void configureColumnInRepository(
      board,
      columnId,
      name,
      color,
      wipPolicy,
    ).then((updated) => {
      onBoard(updated);
      onMessage(copy("c282"));
    });
  };
  return (
    <aside
      className="detail-panel"
      aria-label={copy("c316", { name: column.name })}
    >
      <header>
        <div>
          <span className="eyebrow">{copy("c179")}</span>
          <h2>{copy("c180")}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={copy("c181")}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        <label>
          {copy("c182")}

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {copy("c183")}

          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label>
          {copy("c184")}

          <select
            value={wipKind}
            onChange={(event) =>
              setWipKind(event.target.value as WipPolicy["kind"])
            }
          >
            <option value="none">{copy("c145")}</option>
            <option value="warning">{copy("c185")}</option>
            <option value="hard">{copy("c186")}</option>
          </select>
        </label>
        {wipKind !== "none" && (
          <label>
            {copy("c187")}

            <input
              type="number"
              min="1"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
        )}
        <button className="primary-button" onClick={saveColumn}>
          {copy("c188")}
        </button>
        <button
          className="text-button danger"
          disabled={board.columns.length < 2}
          onClick={() => setDeleteOpen(true)}
        >
          <Icon name="delete" />
          {copy("c189")}
        </button>
        {deleteOpen && (
          <section
            className="deletion-impact"
            role="alertdialog"
            aria-label={copy("c190")}
          >
            <h3>{copy("c191")}</h3>
            <p>
              {affectedTasks.length}
              {copy("c192")}
            </p>
            <ul>
              {affectedTasks.map((task) => (
                <li key={task.id}>{task.title}</li>
              ))}
            </ul>
            <p>{copy("c349", { count: affectedAutomations.length })}</p>
            <ul>
              {affectedAutomations.map((automation) => (
                <li key={automation.automationId}>{automation.draft.name}</li>
              ))}
            </ul>
            <label>
              {copy("c193")}

              <select
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                {board.columns
                  .filter((candidate) => candidate.id !== columnId)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="text-button"
                onClick={() => setDeleteOpen(false)}
              >
                {copy("c012")}
              </button>
              <button
                className="primary-button danger-fill"
                onClick={() =>
                  void deleteColumnInRepository(
                    board,
                    columnId,
                    destinationId,
                  ).then((updated) => {
                    onBoard(updated);
                    onClose();
                    onMessage(copy("c283"));
                  })
                }
              >
                {copy("c194")}
              </button>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
