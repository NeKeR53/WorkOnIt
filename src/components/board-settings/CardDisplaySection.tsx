import { useState } from "react";
import { copy } from "../../i18n";
import { persistBoard } from "../../lib/repository";
import type { Board } from "../../lib/types";

export function CardDisplaySection({
  board,
  onBoard,
  onMessage,
}: {
  board: Board;
  onBoard: (board: Board) => void;
  onMessage: (message: string) => void;
}) {
  const [cardDisplay, setCardDisplay] = useState(board.cardDisplay);
  return (
    <section>
      <h3>{copy("c335")}</h3>
      {(
        [
          ["tags", copy("c336")],
          ["priority", copy("c337")],
          ["dueDate", copy("c338")],
          ["source", copy("c339")],
          ["automationStatus", copy("c340")],
        ] as const
      ).map(([key, label]) => (
        <label className="check-row" key={key}>
          <input
            type="checkbox"
            checked={cardDisplay[key]}
            onChange={(event) =>
              setCardDisplay((current) => ({
                ...current,
                [key]: event.target.checked,
              }))
            }
          />
          {label}
        </label>
      ))}
      <button
        className="secondary-button"
        onClick={() => {
          const updated = { ...board, cardDisplay };
          onBoard(updated);
          void persistBoard(updated);
          onMessage(copy("c342"));
        }}
      >
        {copy("c341")}
      </button>
    </section>
  );
}
