import { useState } from "react";
import { copy } from "../../i18n";
import { addCustomFieldInRepository } from "../../lib/repository";
import type { Board, FieldKind } from "../../lib/types";

export function CustomFieldsSection({
  board,
  onBoard,
  onMessage,
}: {
  board: Board;
  onBoard: (board: Board) => void;
  onMessage: (message: string) => void;
}) {
  const [fieldName, setFieldName] = useState("");
  const [fieldKind, setFieldKind] = useState<FieldKind>("text");
  const [listOptions, setListOptions] = useState("");
  const [pinned, setPinned] = useState(false);
  return (
    <section>
      <h3>{copy("c203")}</h3>
      <label>
        {copy("c182")}

        <input
          value={fieldName}
          onChange={(event) => setFieldName(event.target.value)}
        />
      </label>
      <label>
        {copy("c083")}

        <select
          value={typeof fieldKind === "object" ? "list" : fieldKind}
          onChange={(event) => {
            const value = event.target.value;
            setFieldKind(
              value === "list"
                ? { list: { options: [] } }
                : (value as Exclude<
                    FieldKind,
                    { list: { options: string[] } }
                  >),
            );
          }}
        >
          <option value="text">{copy("c066")}</option>
          <option value="number">{copy("c204")}</option>
          <option value="boolean">{copy("c205")}</option>
          <option value="date">{copy("c206")}</option>
          <option value="secret">{copy("c207")}</option>
          <option value="list">{copy("c208")}</option>
        </select>
      </label>
      {typeof fieldKind === "object" && (
        <label>
          {copy("c209")}

          <textarea
            value={listOptions}
            onChange={(event) => {
              setListOptions(event.target.value);
              setFieldKind({
                list: {
                  options: event.target.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                },
              });
            }}
          />
        </label>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(event) => setPinned(event.target.checked)}
        />{" "}
        {copy("c210")}
      </label>
      <button
        className="secondary-button"
        disabled={!fieldName.trim()}
        onClick={() =>
          void addCustomFieldInRepository(
            board,
            fieldName,
            fieldKind,
            pinned,
          ).then((updated) => {
            onBoard(updated);
            setFieldName("");
            onMessage(copy("c285"));
          })
        }
      >
        {copy("c211")}
      </button>
      {board.customFields.map((field) => (
        <p key={field.id}>
          {field.name}
          {field.pinned && ` · ${copy("c286")}`}
        </p>
      ))}
    </section>
  );
}
