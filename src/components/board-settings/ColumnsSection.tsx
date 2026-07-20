import { useState } from "react";
import { copy } from "../../i18n";
import { Icon } from "../Icon";
import { addColumnInRepository } from "../../lib/repository";
import type { Board } from "../../lib/types";

export function ColumnsSection({
  board,
  onBoard,
}: {
  board: Board;
  onBoard: (board: Board) => void;
}) {
  const [columnName, setColumnName] = useState("");
  return (
    <section>
      <h3>{copy("c196")}</h3>
      <p>{copy("c375")}</p>
      <ul className="settings-item-list">
        {board.columns.map((column) => (
          <li key={column.id}>
            <span className="color-dot" style={{ background: column.color }} />
            {column.name}
          </li>
        ))}
      </ul>
      <div className="section-footer button-row">
        <input
          aria-label={copy("c197")}
          value={columnName}
          onChange={(event) => setColumnName(event.target.value)}
          placeholder={copy("c198")}
        />

        <button
          className="secondary-button"
          disabled={!columnName.trim()}
          onClick={() =>
            void addColumnInRepository(board, columnName).then((updated) => {
              onBoard(updated);
              setColumnName("");
            })
          }
        >
          <Icon name="add" />
          {copy("c199")}
        </button>
      </div>
    </section>
  );
}
