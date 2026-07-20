import type { ReactNode } from "react";
import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { SourcePreview } from "../../lib/backend-types";

export function PreviewPane({
  preview,
  lastOutput,
  active,
  action,
}: {
  preview: SourcePreview | null;
  lastOutput: {
    exitCode?: number;
    truncated: boolean;
    encodingErrors: boolean;
  } | null;
  active: boolean;
  action?: ReactNode;
}) {
  return (
    <section className={active ? "preview-pane mobile-active" : "preview-pane"}>
      <div className="pane-title">
        <strong>{copy("c114")}</strong>
        <span>
          {preview?.records.length ?? 0} {copy("c115")}
        </span>
      </div>
      {lastOutput && (lastOutput.exitCode !== 0 || lastOutput.truncated) && (
        <p className="inline-error">
          <Icon name="warning" />
          {copy("c116")}
          {lastOutput.exitCode ?? "inconnu"}
          {lastOutput.truncated && ` · ${copy("c272")}`}
          {copy("c117")}
        </p>
      )}
      {preview?.warnings.map((warning) => (
        <p className="wip-warning" key={warning}>
          <Icon name="warning" />
          {warning}
        </p>
      ))}
      {preview?.records.map((record, index) => (
        <div className="preview-task" key={`${record.externalKey}-${index}`}>
          <Icon name="task_alt" />
          <span>
            {record.title}
            <small>{record.externalKey ?? copy("c273")}</small>
          </span>
        </div>
      ))}
      {!preview && (
        <div className="pane-empty">
          <Icon name="visibility" />
          <p>{copy("c118")}</p>
        </div>
      )}
      {action}
    </section>
  );
}
