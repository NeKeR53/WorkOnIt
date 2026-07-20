import { copy } from "../i18n";
import { setSecret } from "../lib/repository";
import { type Board, type CustomFieldValue, type Task } from "../lib/types";

export function CustomFieldEditor({
  task,
  field,
  disabled,
  onChange,
}: {
  task: Task;
  field: Board["customFields"][number];
  disabled?: boolean;
  onChange: (value: CustomFieldValue) => void;
}) {
  const current = task.customValues[field.id];
  if (field.kind === "boolean")
    return (
      <label className="check-row">
        <input
          disabled={disabled}
          type="checkbox"
          checked={current?.kind === "boolean" && current.value}
          onChange={(event) =>
            onChange({ kind: "boolean", value: event.target.checked })
          }
        />{" "}
        {field.name}
      </label>
    );

  if (field.kind === "number")
    return (
      <label>
        {field.name}
        <input
          disabled={disabled}
          type="number"
          value={current?.kind === "number" ? current.value : ""}
          onChange={(event) =>
            onChange({ kind: "number", value: Number(event.target.value) })
          }
        />
      </label>
    );

  if (field.kind === "date")
    return (
      <label>
        {field.name}
        <input
          disabled={disabled}
          type="date"
          value={current?.kind === "date" ? current.value : ""}
          onChange={(event) =>
            onChange({ kind: "date", value: event.target.value })
          }
        />
      </label>
    );

  if (field.kind === "secret") {
    const logicalName = `task-${task.id}-field-${field.id}`;
    return (
      <label>
        {field.name}
        <input
          disabled={disabled}
          type="password"
          value=""
          autoComplete="new-password"
          placeholder={
            current?.kind === "secretRef" ? copy("c261") : copy("c313")
          }
          onChange={(event) => {
            const secret = event.target.value;
            if (secret)
              void setSecret(logicalName, secret).then(() =>
                onChange({ kind: "secretRef", value: logicalName }),
              );
          }}
        />
      </label>
    );
  }
  if (typeof field.kind === "object")
    return (
      <label>
        {field.name}
        <select
          disabled={disabled}
          value={current?.kind === "list" ? current.value : ""}
          onChange={(event) =>
            onChange({ kind: "list", value: event.target.value })
          }
        >
          <option value="">{copy("c044")}</option>
          {field.kind.list.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );

  return (
    <label>
      {field.name}
      <input
        disabled={disabled}
        value={current?.kind === "text" ? current.value : ""}
        onChange={(event) =>
          onChange({ kind: "text", value: event.target.value })
        }
      />
    </label>
  );
}
