import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { ExecutionRecord } from "../../lib/backend-types";

export function ExecutionDetail({
  execution,
  onClose,
  onRecover,
  onAbandon,
}: {
  execution: ExecutionRecord;
  onClose: () => void;
  onRecover: (restartAll: boolean) => void;
  onAbandon: () => void;
}) {
  return (
    <aside className="execution-detail" aria-label={copy("c174")}>
      <header>
        <h3>{copy("c175")}</h3>
        <button
          className="icon-button"
          aria-label={copy("c176")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {execution.steps.map((step) => (
        <section key={`${step.actionId}-${step.startedAt}`}>
          <h4>
            {step.actionName} · {step.status}
          </h4>
          {step.stdout && <pre aria-label={copy("c177")}>{step.stdout}</pre>}
          {step.stderr && (
            <pre className="error-output" aria-label={copy("c178")}>
              {step.stderr}
            </pre>
          )}
        </section>
      ))}
      {(execution.status === "failed" ||
        execution.status === "interrupted") && (
        <footer aria-label={copy("c324")}>
          <button className="secondary-button" onClick={() => onRecover(false)}>
            {copy("c319")}
          </button>
          <button className="secondary-button" onClick={() => onRecover(true)}>
            {copy("c320")}
          </button>
          {execution.status === "interrupted" && (
            <button className="text-button danger" onClick={onAbandon}>
              {copy("c321")}
            </button>
          )}
        </footer>
      )}
    </aside>
  );
}
