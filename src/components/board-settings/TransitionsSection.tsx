import { useState } from "react";
import { copy } from "../../i18n";
import { setTransitionRulesInRepository } from "../../lib/repository";
import type { Board } from "../../lib/types";

export function TransitionsSection({
  board,
  onBoard,
  onMessage,
}: {
  board: Board;
  onBoard: (board: Board) => void;
  onMessage: (message: string) => void;
}) {
  const [restricted, setRestricted] = useState(board.transitionsRestricted);
  const [rules, setRules] = useState(board.allowedTransitions);
  const toggleRule = (fromColumnId: string, toColumnId: string) => {
    const exists = rules.some(
      (rule) =>
        rule.fromColumnId === fromColumnId && rule.toColumnId === toColumnId,
    );
    setRules(
      exists
        ? rules.filter(
            (rule) =>
              rule.fromColumnId !== fromColumnId ||
              rule.toColumnId !== toColumnId,
          )
        : [...rules, { fromColumnId, toColumnId }],
    );
  };
  return (
    <section>
      <h3>{copy("c200")}</h3>
      <p>{copy("c376")}</p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(event) => setRestricted(event.target.checked)}
        />{" "}
        {copy("c201")}
      </label>
      {restricted && (
        <div className="transition-matrix">
          {board.columns.flatMap((from) =>
            board.columns
              .filter((to) => to.id !== from.id)
              .map((to) => (
                <label className="check-row" key={`${from.id}-${to.id}`}>
                  <input
                    type="checkbox"
                    checked={rules.some(
                      (rule) =>
                        rule.fromColumnId === from.id &&
                        rule.toColumnId === to.id,
                    )}
                    onChange={() => toggleRule(from.id, to.id)}
                  />{" "}
                  {from.name} → {to.name}
                </label>
              )),
          )}
        </div>
      )}
      <button
        className="secondary-button"
        onClick={() =>
          void setTransitionRulesInRepository(board, restricted, rules).then(
            (updated) => {
              onBoard(updated);
              onMessage(copy("c284"));
            },
          )
        }
      >
        {copy("c202")}
      </button>
    </section>
  );
}
