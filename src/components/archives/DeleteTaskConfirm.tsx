import { copy } from "../../i18n";

export function DeleteTaskConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="danger-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-label={copy("c217")}
    >
      <p>{copy("c218")}</p>
      <div>
        <button className="text-button" onClick={onCancel}>
          {copy("c012")}
        </button>
        <button className="primary-button danger-fill" onClick={onConfirm}>
          {copy("c219")}
        </button>
      </div>
    </div>
  );
}
