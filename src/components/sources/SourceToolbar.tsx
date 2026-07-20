import { copy } from "../../i18n";
import { Icon } from "../Icon";
import { isDesktopRuntime } from "../../lib/repository";
import type { SourceDefinition } from "../../lib/backend-types";

export function SourceToolbar({
  source,
  busy,
  onChange,
  onSave,
  onInspect,
  onCancel,
}: {
  source: SourceDefinition;
  busy: boolean;
  onChange: (source: SourceDefinition) => void;
  onSave: (enabled: boolean) => void;
  onInspect: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="source-toolbar">
      <label>
        {copy("c062")}

        <input
          value={source.name}
          onChange={(event) =>
            onChange({ ...source, name: event.target.value })
          }
        />
      </label>
      <label>
        {copy("c063")}

        <select
          value={source.format}
          onChange={(event) =>
            onChange({
              ...source,
              format: event.target.value as SourceDefinition["format"],
            })
          }
        >
          <option value="json">{copy("c064")}</option>
          <option value="jsonl">{copy("c065")}</option>
          <option value="text">{copy("c066")}</option>
        </select>
      </label>
      <label>
        {copy("c067")}

        <select
          value={source.encoding}
          onChange={(event) =>
            onChange({
              ...source,
              encoding: event.target.value as SourceDefinition["encoding"],
            })
          }
        >
          <option value="utf8">{copy("c068")}</option>
          <option value="windows1252">{copy("c069")}</option>
          <option value="system">{copy("c047")}</option>
          <option value="auto">{copy("c070")}</option>
        </select>
      </label>
      <label>
        {copy("c071")}

        <input
          value={source.command.script}
          onChange={(event) =>
            onChange({
              ...source,
              command: { ...source.command, script: event.target.value },
            })
          }
        />
      </label>
      <button className="secondary-button" onClick={() => onSave(false)}>
        {copy("c072")}
      </button>
      <button className="primary-button" onClick={() => onSave(true)}>
        {copy("c073")}
      </button>
      {source.enabled && isDesktopRuntime() && (
        <>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onInspect}
          >
            <Icon name="play_arrow" />
            {copy("c074")}
          </button>
          <button
            className="text-button danger"
            disabled={!busy}
            onClick={onCancel}
          >
            <Icon name="stop_circle" />
            {copy("c344")}
          </button>
        </>
      )}
    </div>
  );
}
