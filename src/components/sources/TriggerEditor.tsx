import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { TriggerDefinition } from "../../lib/backend-types";

export function TriggerEditor({
  trigger,
  onChange,
  onSave,
}: {
  trigger: TriggerDefinition;
  onChange: (trigger: TriggerDefinition) => void;
  onSave: () => void;
}) {
  return (
    <details className="trigger-editor">
      <summary>
        <Icon name="schedule" />
        {copy("c082")}
      </summary>
      <label>
        {copy("c083")}

        <select
          value={trigger.schedule?.kind ?? "interval"}
          onChange={(event) => {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const kind = event.target.value;
            const schedule =
              kind === "daily"
                ? {
                    kind: "daily" as const,
                    hour: 9,
                    minute: 0,
                    timezone,
                  }
                : kind === "weekly"
                  ? {
                      kind: "weekly" as const,
                      weekdays: [1],
                      hour: 9,
                      minute: 0,
                      timezone,
                    }
                  : kind === "cron"
                    ? {
                        kind: "cron" as const,
                        expression: "0 0 9 * * *",
                        timezone,
                      }
                    : { kind: "interval" as const, seconds: 3600 };
            onChange({ ...trigger, schedule });
          }}
        >
          <option value="interval">{copy("c084")}</option>
          <option value="daily">{copy("c085")}</option>
          <option value="weekly">{copy("c086")}</option>
          <option value="cron">{copy("c087")}</option>
        </select>
      </label>
      {trigger.schedule?.kind === "interval" && (
        <label>
          {copy("c088")}

          <input
            aria-label={copy("c078")}
            type="number"
            min="1"
            value={trigger.schedule.seconds}
            onChange={(event) =>
              onChange({
                ...trigger,
                schedule: {
                  kind: "interval",
                  seconds: Number(event.target.value),
                },
              })
            }
          />
        </label>
      )}
      {trigger.schedule?.kind === "cron" && (
        <>
          <label>
            {copy("c089")}

            <input
              value={trigger.schedule.expression}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  schedule: {
                    kind: "cron",
                    expression: event.target.value,
                    timezone: (
                      trigger.schedule as {
                        kind: "cron";
                        expression: string;
                        timezone: string;
                      }
                    ).timezone,
                  },
                })
              }
            />
          </label>
          <label>
            {copy("c090")}

            <input
              value={trigger.schedule.timezone}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  schedule: {
                    ...trigger.schedule!,
                    timezone: event.target.value,
                  } as TriggerDefinition["schedule"],
                })
              }
            />
          </label>
        </>
      )}
      {(trigger.schedule?.kind === "daily" ||
        trigger.schedule?.kind === "weekly") && (
        <>
          <label>
            {copy("c091")}

            <input
              type="number"
              min="0"
              max="23"
              value={trigger.schedule.hour}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  schedule: {
                    ...trigger.schedule!,
                    hour: Number(event.target.value),
                  } as TriggerDefinition["schedule"],
                })
              }
            />
          </label>
          <label>
            {copy("c092")}

            <input
              type="number"
              min="0"
              max="59"
              value={trigger.schedule.minute}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  schedule: {
                    ...trigger.schedule!,
                    minute: Number(event.target.value),
                  } as TriggerDefinition["schedule"],
                })
              }
            />
          </label>
          <label>
            {copy("c090")}

            <input
              value={trigger.schedule.timezone}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  schedule: {
                    ...trigger.schedule!,
                    timezone: event.target.value,
                  } as TriggerDefinition["schedule"],
                })
              }
            />
          </label>
        </>
      )}
      {trigger.schedule?.kind === "weekly" && (
        <fieldset>
          <legend>{copy("c093")}</legend>
          {[
            [1, "Lun"],
            [2, "Mar"],
            [3, "Mer"],
            [4, "Jeu"],
            [5, "Ven"],
            [6, "Sam"],
            [7, "Dim"],
          ].map(([day, label]) => (
            <label className="check-row" key={day}>
              <input
                type="checkbox"
                checked={
                  trigger.schedule?.kind === "weekly" &&
                  trigger.schedule.weekdays.includes(Number(day))
                }
                onChange={(event) => {
                  const schedule = trigger.schedule as Extract<
                    NonNullable<TriggerDefinition["schedule"]>,
                    { kind: "weekly" }
                  >;
                  const weekdays = event.target.checked
                    ? [...new Set([...schedule.weekdays, Number(day)])]
                    : schedule.weekdays.filter(
                        (value) => value !== Number(day),
                      );
                  onChange({
                    ...trigger,
                    schedule: { ...schedule, weekdays },
                  });
                }}
              />{" "}
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={trigger.catchUpLast}
          onChange={(event) =>
            onChange({ ...trigger, catchUpLast: event.target.checked })
          }
        />{" "}
        {copy("c094")}
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={trigger.enabled}
          onChange={(event) =>
            onChange({ ...trigger, enabled: event.target.checked })
          }
        />{" "}
        {copy("c095")}
      </label>
      <button className="secondary-button" onClick={onSave}>
        {copy("c096")}
      </button>
    </details>
  );
}
