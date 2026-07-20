import { useEffect, useState } from "react";
import { copy } from "../../i18n";
import { getSetting, setSetting } from "../../lib/repository";

export function LogsSection() {
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [logMaxMegabytes, setLogMaxMegabytes] = useState(100);
  useEffect(() => {
    void Promise.all([
      getSetting("logs.retention_days"),
      getSetting("logs.max_megabytes"),
    ]).then(([retention, maxMegabytes]) => {
      setLogRetentionDays(Number(retention) || 30);
      setLogMaxMegabytes(Number(maxMegabytes) || 100);
    });
  }, []);
  return (
    <section>
      <h3>{copy("c227")}</h3>
      <label>
        {copy("c228")}

        <input
          type="number"
          min="0"
          value={logRetentionDays}
          onChange={(event) => {
            const value = Math.max(0, Number(event.target.value));
            setLogRetentionDays(value);
            void setSetting("logs.retention_days", String(value));
          }}
        />
      </label>
      <label>
        {copy("c229")}

        <input
          type="number"
          min="1"
          value={logMaxMegabytes}
          onChange={(event) => {
            const value = Math.max(1, Number(event.target.value));
            setLogMaxMegabytes(value);
            void setSetting("logs.max_megabytes", String(value));
          }}
        />
      </label>
      <p>{copy("c230")}</p>
    </section>
  );
}
