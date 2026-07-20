import { copy } from "../../i18n";
import { Icon } from "../Icon";
import { rememberCommandRunner } from "../../lib/repository";
import type { CommandAction } from "../../lib/backend-types";

export function CommandTab({
  action,
  runnerOptions,
  onChange,
}: {
  action: CommandAction;
  runnerOptions: string[];
  onChange: (action: CommandAction) => void;
}) {
  return (
    <div className="code-editor">
      <div className="code-meta">
        <label>
          {copy("c076")}

          <select
            value={action.runner}
            onChange={(event) => {
              rememberCommandRunner(event.target.value);
              onChange({ ...action, runner: event.target.value });
            }}
          >
            {runnerOptions.map((runner) => (
              <option key={runner} value={runner}>
                {runner}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            onChange({
              ...action,
              script: `${action.script}$WORKONIT_TITLE`,
            })
          }
        >
          <Icon name="data_object" />
          {copy("c140")}
        </button>
      </div>
      <div>
        <span className="line-number">1</span>
        <textarea
          aria-label={copy("c141")}
          value={action.script}
          onChange={(event) =>
            onChange({ ...action, script: event.target.value })
          }
        />
      </div>
    </div>
  );
}
