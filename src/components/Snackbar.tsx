import { useEffect, useRef } from "react";
import { copy } from "../i18n";
import { Icon } from "./Icon";

const AUTO_DISMISS_DELAY_MS = 5_000;

export function Snackbar({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => onCloseRef.current(),
      AUTO_DISMISS_DELAY_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [message]);

  return (
    <div className="snackbar" role="alert">
      {message}
      {onRetry && <button onClick={onRetry}>{copy("c014")}</button>}
      <button onClick={onClose} aria-label={copy("c015")}>
        <Icon name="close" />
      </button>
    </div>
  );
}
