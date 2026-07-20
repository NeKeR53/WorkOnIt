import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { BackupInfo } from "../../lib/backend-types";

export function BackupsSection({
  backups,
  onCreate,
  onRestoreRequest,
}: {
  backups: BackupInfo[];
  onCreate: () => void;
  onRestoreRequest: (backup: BackupInfo) => void;
}) {
  return (
    <section>
      <h3>{copy("c243")}</h3>
      <button className="secondary-button" onClick={onCreate}>
        <Icon name="backup" />
        {copy("c244")}
      </button>
      <div className="backup-list">
        {backups.map((backup) => (
          <button key={backup.path} onClick={() => onRestoreRequest(backup)}>
            <span>{backup.name}</span>
            <small>
              {Math.ceil(backup.bytes / 1024)}
              {copy("c245")}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
