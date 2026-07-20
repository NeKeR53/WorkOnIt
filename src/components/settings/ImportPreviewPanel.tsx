import { copy } from "../../i18n";
import type { Board } from "../../lib/types";
import type {
  CommandAction,
  ImportConflict,
  ImportResult,
} from "../../lib/backend-types";

export type ConflictDecision = "update" | "copy" | "ignore";

export function ImportPreviewPanel({
  preview,
  conflicts,
  decisions,
  trust,
  boards,
  onDecision,
  onTrust,
  onApply,
}: {
  preview: ImportResult;
  conflicts: ImportConflict[];
  decisions: Record<string, ConflictDecision>;
  trust: boolean;
  boards: Board[];
  onDecision: (key: string, decision: ConflictDecision) => void;
  onTrust: (trust: boolean) => void;
  onApply: () => void;
}) {
  const importedBoards = preview.bundle.boards;
  const environmentKey = (value: string) =>
    value
      .split("")
      .map((character) =>
        /[a-z0-9]/i.test(character) ? character.toUpperCase() : "_",
      )
      .join("");
  const commandTrustSummary = (command: CommandAction) =>
    `\n${command.runner}\n${command.workingDirectory ?? copy("c295")}\n${command.script}\n${command.variants
      .map(
        (variant) =>
          `${copy("c350", { platform: variant.operatingSystem })}\n${variant.runner}\n${variant.script}`,
      )
      .join(
        "\n",
      )}\n${copy("c351")}: ${command.arguments.join(" ") || "—"}\n${copy("c352")}: ${command.directExecution ? copy("c353") : copy("c354")}\nWORKONIT_*: WORKONIT_TASK_ID, WORKONIT_TITLE, WORKONIT_DESCRIPTION, WORKONIT_COLUMN_ID${[
      ...boards,
      ...importedBoards,
    ]
      .flatMap((board) => board.customFields)
      .map((field) => `, WORKONIT_FIELD_${environmentKey(field.id)}`)
      .join(
        "",
      )}\nSecrets: ${command.secretNames.map((name) => `WORKONIT_SECRET_${environmentKey(name)}`).join(", ") || "—"}\n${copy("c355")}`;

  return (
    <div className="import-preview">
      <h4>{copy("c234")}</h4>
      <p>
        {preview.bundle.boards.length}
        {copy("c235")} {preview.bundle.actions.length}
        {copy("c236")} {preview.bundle.sources.length}
        {copy("c237")}
      </p>
      {preview.bundle.actions
        .filter((action) => preview.trustRequiredActions.includes(action.id))
        .map((action) => (
          <pre key={action.id}>
            <strong>{action.name}</strong>
            {commandTrustSummary(action)}
          </pre>
        ))}
      {preview.bundle.sources
        .filter((source) => preview.trustRequiredSources.includes(source.id))
        .map((source) => (
          <pre key={source.id}>
            <strong>{source.name}</strong>
            {commandTrustSummary(source.command)}
          </pre>
        ))}
      {conflicts.map((conflict) => (
        <label key={`${conflict.kind}:${conflict.id}`}>
          {conflict.name}
          <select
            value={decisions[`${conflict.kind}:${conflict.id}`]}
            onChange={(event) =>
              onDecision(
                `${conflict.kind}:${conflict.id}`,
                event.target.value as ConflictDecision,
              )
            }
          >
            <option value="update">{copy("c238")}</option>
            <option value="copy">{copy("c239")}</option>
            <option value="ignore">{copy("c240")}</option>
          </select>
        </label>
      ))}
      <label className="check-row">
        <input
          type="checkbox"
          checked={trust}
          onChange={(event) => onTrust(event.target.checked)}
        />{" "}
        {copy("c241")}
      </label>
      <button className="primary-button" onClick={onApply}>
        {copy("c242")}
      </button>
    </div>
  );
}
