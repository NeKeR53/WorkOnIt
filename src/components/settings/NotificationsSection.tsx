import { useEffect, useState } from "react";
import { copy } from "../../i18n";
import { getSetting, setSetting, type SettingKey } from "../../lib/repository";

export function NotificationsSection() {
  const [notifications, setNotifications] = useState({
    failure: true,
    confirmation: true,
    source: true,
    success: false,
  });
  useEffect(() => {
    void Promise.all([
      getSetting("notifications.failure"),
      getSetting("notifications.confirmation"),
      getSetting("notifications.source_blocked"),
      getSetting("notifications.success"),
    ]).then(([failure, confirmation, source, success]) => {
      setNotifications({
        failure: failure !== "false",
        confirmation: confirmation !== "false",
        source: source !== "false",
        success: success === "true",
      });
    });
  }, []);
  const toggle = (key: keyof typeof notifications) => {
    const value = !notifications[key];
    setNotifications((current) => ({ ...current, [key]: value }));
    const setting: SettingKey =
      key === "source"
        ? "notifications.source_blocked"
        : `notifications.${key}`;
    void setSetting(setting, String(value));
  };
  return (
    <section>
      <h3>{copy("c226")}</h3>
      {(
        [
          ["failure", copy("c291")],
          ["confirmation", copy("c292")],
          ["source", copy("c293")],
          ["success", copy("c294")],
        ] as const
      ).map(([key, label]) => (
        <label className="check-row" key={key}>
          <input
            type="checkbox"
            checked={notifications[key]}
            onChange={() => toggle(key)}
          />{" "}
          {label}
        </label>
      ))}
    </section>
  );
}
