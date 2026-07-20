import { useEffect, useState } from "react";
import { copy } from "../../i18n";
import { isDesktopRuntime } from "../../lib/repository";

export function LifecycleSection() {
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then(setAutostart);
  }, []);
  return (
    <section>
      <h3>{copy("c223")}</h3>
      <label className="check-row">
        <input
          type="checkbox"
          checked={autostart}
          onChange={(event) => {
            const value = event.target.checked;
            setAutostart(value);
            if (isDesktopRuntime())
              void import("@tauri-apps/plugin-autostart").then(
                ({ enable, disable }) => (value ? enable() : disable()),
              );
          }}
        />{" "}
        {copy("c224")}
      </label>
      <p>{copy("c225")}</p>
    </section>
  );
}
