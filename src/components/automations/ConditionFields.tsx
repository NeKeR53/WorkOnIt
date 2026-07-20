import { copy } from "../../i18n";
import type { Board } from "../../lib/types";
import type { ActionCondition } from "../../lib/backend-types";

export function ConditionFields({
  condition,
  board,
  onChange,
}: {
  condition: ActionCondition | undefined;
  board: Board;
  onChange: (condition: ActionCondition | undefined) => void;
}) {
  return (
    <fieldset>
      <legend>{copy("c128")}</legend>
      <label>
        {copy("c083")}

        <select
          value={condition?.kind ?? "none"}
          onChange={(event) => {
            const kind = event.target.value;
            onChange(
              kind === "fieldEquals"
                ? { kind, field: "title", value: "" }
                : kind === "fieldContains"
                  ? { kind, field: "title", value: "" }
                  : kind === "origin"
                    ? { kind, origin: "user" }
                    : undefined,
            );
          }}
        >
          <option value="none">{copy("c129")}</option>
          <option value="fieldEquals">{copy("c130")}</option>
          <option value="fieldContains">{copy("c131")}</option>
          <option value="origin">{copy("c132")}</option>
        </select>
      </label>
      {(condition?.kind === "fieldEquals" ||
        condition?.kind === "fieldContains") && (
        <>
          <label>
            {copy("c133")}

            <select
              value={condition.field}
              onChange={(event) =>
                onChange({ ...condition, field: event.target.value })
              }
            >
              <option value="title">{copy("c021")}</option>
              <option value="description">{copy("c030")}</option>
              <option value="priority">{copy("c020")}</option>
              <option value="tags">{copy("c036")}</option>
              {board?.customFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy("c134")}

            <input
              value={condition.value}
              onChange={(event) =>
                onChange({ ...condition, value: event.target.value })
              }
            />
          </label>
        </>
      )}
      {condition?.kind === "origin" && (
        <label>
          {copy("c132")}

          <select
            value={condition.origin}
            onChange={(event) =>
              onChange({
                ...condition,
                origin: event.target.value as
                  "user" | "source" | "plugin" | "system",
              })
            }
          >
            <option value="user">{copy("c135")}</option>
            <option value="source">{copy("c062")}</option>
            <option value="plugin">{copy("c136")}</option>
            <option value="system">{copy("c047")}</option>
          </select>
        </label>
      )}
    </fieldset>
  );
}
