import { useEffect, useState } from "react";
import { copy } from "../../i18n";
import { loadSources, persistBoard } from "../../lib/repository";
import type { Board } from "../../lib/types";
import type { SourceDefinition } from "../../lib/backend-types";

export function BoardSourcesSection({
  board,
  onBoard,
  onMessage,
}: {
  board: Board;
  onBoard: (board: Board) => void;
  onMessage: (message: string) => void;
}) {
  const [availableSources, setAvailableSources] = useState<SourceDefinition[]>(
    [],
  );
  const [sourceIds, setSourceIds] = useState(board.sourceIds ?? []);
  useEffect(() => {
    void loadSources().then(setAvailableSources);
  }, []);
  return (
    <section>
      <h3>{copy("c368")}</h3>
      <p>{copy("c369")}</p>
      {availableSources.length ? (
        availableSources.map((source) => (
          <label className="check-row" key={source.id}>
            <input
              type="checkbox"
              checked={sourceIds.includes(source.id)}
              onChange={() =>
                setSourceIds((current) =>
                  current.includes(source.id)
                    ? current.filter((id) => id !== source.id)
                    : [...current, source.id],
                )
              }
            />
            {source.name}
          </label>
        ))
      ) : (
        <p>{copy("c366")}</p>
      )}
      <div className="section-footer">
        <button
          className="secondary-button"
          onClick={() => {
            const updated = { ...board, sourceIds };
            onBoard(updated);
            void persistBoard(updated);
            onMessage(copy("c370"));
          }}
        >
          {copy("c371")}
        </button>
      </div>
    </section>
  );
}
