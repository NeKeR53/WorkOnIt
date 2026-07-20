import { copy } from "../../i18n";
import type { TransitionAutomation } from "../../lib/backend-types";

type Notifications = NonNullable<TransitionAutomation["notifications"]>;

export function NotificationsFieldset({
  value,
  onChange,
}: {
  value: Notifications;
  onChange: (value: Notifications) => void;
}) {
  return (
    <fieldset>
      <legend>{copy("c157")}</legend>
      {(
        [
          ["success", copy("c294")],
          ["failure", copy("c291")],
          ["confirmation", copy("c306")],
          ["sourceBlocked", copy("c307")],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            value={value[key] === undefined ? "inherit" : String(value[key])}
            onChange={(event) =>
              onChange({
                ...value,
                [key]:
                  event.target.value === "inherit"
                    ? undefined
                    : event.target.value === "true",
              })
            }
          >
            <option value="inherit">{copy("c158")}</option>
            <option value="true">{copy("c159")}</option>
            <option value="false">{copy("c160")}</option>
          </select>
        </label>
      ))}
    </fieldset>
  );
}
