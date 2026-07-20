import { copy } from "../../i18n";
import type { BackupInfo } from "../../lib/backend-types";

export function RestoreBackupConfirm({
  backup,
  onCancel,
  onConfirm,
}: {
  backup: BackupInfo;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="danger-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-label={copy("c246")}
    >
      <p>
        {copy("c214")}
        {backup.name}
        {copy("c247")}
      </p>
      <div>
        <button className="text-button" onClick={onCancel}>
          {copy("c012")}
        </button>
        <button className="primary-button danger-fill" onClick={onConfirm}>
          {copy("c214")}
        </button>
      </div>
    </div>
  );
}
