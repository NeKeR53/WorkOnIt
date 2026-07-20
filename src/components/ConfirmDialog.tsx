import { copy } from "../i18n";

export function ConfirmDialog({
  ariaLabel,
  title,
  description,
  confirmLabel,
  nested,
  onCancel,
  onConfirm,
}: {
  ariaLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  nested?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={nested ? "dialog-backdrop nested" : "dialog-backdrop"}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <h2>{title}</h2>
        <p>{description}</p>
        <footer>
          <button className="text-button" onClick={onCancel}>
            {copy("c012")}
          </button>
          <button className="primary-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
