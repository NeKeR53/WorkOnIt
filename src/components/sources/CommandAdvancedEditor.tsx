import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { SourceDefinition } from "../../lib/backend-types";

type Command = SourceDefinition["command"];

export function CommandAdvancedEditor({
  command,
  onChange,
}: {
  command: Command;
  onChange: (command: Command) => void;
}) {
  return (
    <details className="trigger-editor">
      <summary>
        <Icon name="tune" />
        {copy("c075")}
      </summary>
      <label>
        {copy("c076")}

        <input
          value={command.runner}
          onChange={(event) =>
            onChange({ ...command, runner: event.target.value })
          }
        />
      </label>
      <label>
        {copy("c077")}

        <input
          value={command.workingDirectory ?? ""}
          onChange={(event) =>
            onChange({
              ...command,
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
          min="0"
          value={command.timeoutSeconds ?? ""}
          onChange={(event) =>
            onChange({
              ...command,
              timeoutSeconds: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
        />
        {!command.timeoutSeconds && <small>{copy("c343")}</small>}
      </label>
      <label>
        {copy("c079")}

        <input
          value={command.acceptedExitCodes.join(", ")}
          onChange={(event) =>
            onChange({
              ...command,
              acceptedExitCodes: event.target.value
                .split(",")
                .map(Number)
                .filter(Number.isFinite),
            })
          }
        />
      </label>
      <label>
        {copy("c080")}

        <input
          value={command.secretNames.join(", ")}
          onChange={(event) =>
            onChange({
              ...command,
              secretNames: event.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={command.loadProfile}
          onChange={(event) =>
            onChange({ ...command, loadProfile: event.target.checked })
          }
        />{" "}
        {copy("c081")}
      </label>
      {(["macOs", "windows"] as const).map((operatingSystem) => {
        const variant = command.variants.find(
          (item) => item.operatingSystem === operatingSystem,
        );
        const replaceVariant = (runner: string, script: string) =>
          onChange({
            ...command,
            variants: [
              ...command.variants.filter(
                (item) => item.operatingSystem !== operatingSystem,
              ),
              { operatingSystem, runner, script },
            ],
          });
        return (
          <fieldset key={operatingSystem}>
            <legend>
              {copy("c334")} ·{" "}
              {operatingSystem === "macOs" ? "macOS" : "Windows"}
            </legend>
            <label>
              {copy("c076")}
              <input
                value={variant?.runner ?? ""}
                onChange={(event) =>
                  replaceVariant(event.target.value, variant?.script ?? "")
                }
              />
            </label>
            <label>
              {copy("c071")}
              <textarea
                value={variant?.script ?? ""}
                onChange={(event) =>
                  replaceVariant(variant?.runner ?? "", event.target.value)
                }
              />
            </label>
          </fieldset>
        );
      })}
    </details>
  );
}
