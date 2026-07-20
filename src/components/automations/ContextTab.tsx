import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { CommandAction } from "../../lib/backend-types";

export function ContextTab({
  action,
  onChange,
}: {
  action: CommandAction;
  onChange: (action: CommandAction) => void;
}) {
  return (
    <div className="automation-form">
      <label>
        {copy("c077")}

        <input
          value={action.workingDirectory ?? ""}
          onChange={(event) =>
            onChange({
              ...action,
              workingDirectory: event.target.value || undefined,
            })
          }
        />
      </label>
      <label>
        {copy("c078")}

        <input
          aria-label={copy("c078")}
          type="number"
          value={action.timeoutSeconds ?? ""}
          onChange={(event) =>
            onChange({
              ...action,
              timeoutSeconds: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
        />
        {!action.timeoutSeconds && <small>{copy("c343")}</small>}
      </label>
      <label>
        {copy("c079")}

        <input
          value={action.acceptedExitCodes.join(", ")}
          onChange={(event) =>
            onChange({
              ...action,
              acceptedExitCodes: event.target.value
                .split(",")
                .map(Number)
                .filter(Number.isFinite),
            })
          }
        />
      </label>
      <label>
        {copy("c142")}

        <input
          type="number"
          min="1"
          value={Math.ceil(action.outputLimitBytes / 1024)}
          onChange={(event) =>
            onChange({
              ...action,
              outputLimitBytes: Number(event.target.value) * 1024,
            })
          }
        />
      </label>
      <label>
        {copy("c143")}

        <input
          value={action.secretNames.join(", ")}
          onChange={(event) =>
            onChange({
              ...action,
              secretNames: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label>
        {copy("c144")}

        <select
          value={action.stdoutValidation?.kind ?? "none"}
          onChange={(event) =>
            onChange({
              ...action,
              stdoutValidation:
                event.target.value === "none"
                  ? undefined
                  : {
                      kind: event.target.value as "regex" | "jsonPath",
                      expression: action.stdoutValidation?.expression ?? "",
                    },
            })
          }
        >
          <option value="none">{copy("c145")}</option>
          <option value="regex">{copy("c146")}</option>
          <option value="jsonPath">{copy("c147")}</option>
        </select>
      </label>
      {action.stdoutValidation && (
        <label>
          {copy("c148")}

          <input
            value={action.stdoutValidation.expression}
            onChange={(event) =>
              onChange({
                ...action,
                stdoutValidation: {
                  ...action.stdoutValidation!,
                  expression: event.target.value,
                },
              })
            }
          />
        </label>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={action.directExecution}
          onChange={(event) =>
            onChange({ ...action, directExecution: event.target.checked })
          }
        />{" "}
        {copy("c149")}
      </label>
      {action.directExecution && (
        <label>
          {copy("c150")}

          <textarea
            value={action.arguments.join("\n")}
            onChange={(event) =>
              onChange({
                ...action,
                arguments: event.target.value.split("\n"),
              })
            }
          />
        </label>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={action.loadProfile}
          onChange={(event) =>
            onChange({ ...action, loadProfile: event.target.checked })
          }
        />{" "}
        {copy("c081")}
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={action.destructive}
          onChange={(event) =>
            onChange({ ...action, destructive: event.target.checked })
          }
        />{" "}
        {copy("c151")}
      </label>
      <p className="security-note">
        <Icon name="shield" />
        {copy("c152")}
      </p>
    </div>
  );
}
