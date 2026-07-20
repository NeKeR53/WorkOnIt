import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { CommandPreview } from "../../lib/backend-types";

export function TestTab({
  preview,
  onPreview,
  onRequestTest,
}: {
  preview: CommandPreview[];
  onPreview: () => void;
  onRequestTest: () => void;
}) {
  return (
    <div className="test-panel">
      <button className="secondary-button" onClick={onPreview}>
        <Icon name="preview" />
        {copy("c161")}
      </button>
      {preview.map((item) => (
        <pre key={item.actionId}>
          <strong>{item.actionName}</strong>
          {`\nRunner: ${item.runner}\n${copy("c077")}: ${item.workingDirectory ?? copy("c280")}\n${copy("c309")}: ${item.environmentVariables.join(", ")}\n${copy("c310")}: ${item.secretNames.join(", ") || copy("c281")}\n\n${item.script}`}
        </pre>
      ))}
      <button className="secondary-button" onClick={onRequestTest}>
        <Icon name="science" />
        {copy("c162")}
      </button>
    </div>
  );
}
