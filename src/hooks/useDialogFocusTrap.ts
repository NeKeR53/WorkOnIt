import { useEffect } from "react";

export function useDialogFocusTrap() {
  useEffect(() => {
    const selector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const dialogs = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        ),
      );
    const focusLatest = () => {
      const dialog = dialogs().at(-1);
      if (dialog && !dialog.contains(document.activeElement))
        dialog.querySelector<HTMLElement>(selector)?.focus();
    };
    const observer = new MutationObserver(() => queueMicrotask(focusLatest));
    observer.observe(document.body, { childList: true, subtree: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = dialogs().at(-1);
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(selector),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", trap);
    };
  }, []);
}
