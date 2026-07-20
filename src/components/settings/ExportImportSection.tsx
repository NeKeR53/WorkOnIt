import { useState, type ReactNode } from "react";
import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { Board } from "../../lib/types";

export type ExportOptions = {
  boardIds: string[];
  includeActions: boolean;
  includeSources: boolean;
  includeTriggers: boolean;
  includeHistory: boolean;
};

export function ExportImportSection({
  boards,
  onExport,
  onChooseImport,
  children,
}: {
  boards: Board[];
  onExport: (options: ExportOptions) => void;
  onChooseImport: () => void;
  children?: ReactNode;
}) {
  const [includeHistory, setIncludeHistory] = useState(false);
  const [selectedBoardIds, setSelectedBoardIds] = useState(() =>
    boards.map((board) => board.id),
  );
  const [includeActions, setIncludeActions] = useState(true);
  const [includeSources, setIncludeSources] = useState(true);
  const [includeTriggers, setIncludeTriggers] = useState(true);
  return (
    <section>
      <h3>{copy("c231")}</h3>
      <fieldset>
        <legend>{copy("c345")}</legend>
        {boards.map((board) => (
          <label className="check-row" key={board.id}>
            <input
              type="checkbox"
              checked={selectedBoardIds.includes(board.id)}
              onChange={(event) =>
                setSelectedBoardIds((current) =>
                  event.target.checked
                    ? [...current, board.id]
                    : current.filter((id) => id !== board.id),
                )
              }
            />{" "}
            {board.name}
          </label>
        ))}
      </fieldset>
      <label className="check-row">
        <input
          type="checkbox"
          checked={includeActions}
          onChange={(event) => setIncludeActions(event.target.checked)}
        />{" "}
        {copy("c346")}
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={includeSources}
          onChange={(event) => setIncludeSources(event.target.checked)}
        />{" "}
        {copy("c347")}
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={includeTriggers}
          disabled={!includeSources}
          onChange={(event) => setIncludeTriggers(event.target.checked)}
        />{" "}
        {copy("c348")}
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={includeHistory}
          onChange={(event) => setIncludeHistory(event.target.checked)}
        />{" "}
        {copy("c232")}
      </label>
      <div className="button-row">
        <button
          className="secondary-button"
          disabled={selectedBoardIds.length === 0}
          onClick={() =>
            onExport({
              boardIds: selectedBoardIds,
              includeActions,
              includeSources,
              includeTriggers,
              includeHistory,
            })
          }
        >
          <Icon name="download" />
          {copy("c233")}
        </button>
        <button className="secondary-button" onClick={onChooseImport}>
          <Icon name="upload" />
          {copy("c119")}
        </button>
      </div>
      {children}
    </section>
  );
}
