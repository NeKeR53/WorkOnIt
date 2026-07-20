import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { ActionStep, CommandAction } from "../../lib/backend-types";

export function ActionChainEditor({
  steps,
  actions,
  selectedIndex,
  onAdd,
  onSelect,
  onToggleStop,
  onMove,
  onRemove,
}: {
  steps: ActionStep[];
  actions: CommandAction[];
  selectedIndex: number;
  onAdd: () => void;
  onSelect: (index: number) => void;
  onToggleStop: (index: number, stopOnFailure: boolean) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <fieldset className="action-chain-editor">
      <legend>{copy("c325")}</legend>
      <button className="secondary-button" type="button" onClick={onAdd}>
        <Icon name="add" />
        {copy("c326")}
      </button>
      {!steps.length && <p>{copy("c327")}</p>}
      {steps.map((step, index) => {
        const stepAction = actions.find((item) => item.id === step.actionId);
        const name = stepAction?.name ?? step.actionId;
        return (
          <article
            className={
              index === selectedIndex
                ? "action-chain-step active"
                : "action-chain-step"
            }
            key={`${step.actionId}-${index}`}
          >
            <button
              className="text-button"
              type="button"
              aria-label={copy("c329", { name })}
              onClick={() => onSelect(index)}
            >
              {copy("c333", { position: index + 1, name })}
            </button>
            <label>
              <input
                type="checkbox"
                checked={step.stopOnFailure}
                onChange={(event) => onToggleStop(index, event.target.checked)}
              />
              {copy("c328")}
            </label>
            <span className="chain-step-actions">
              <button
                className="icon-button"
                type="button"
                disabled={index === 0}
                aria-label={copy("c330", { name })}
                onClick={() => onMove(index, -1)}
              >
                <Icon name="arrow_upward" />
              </button>
              <button
                className="icon-button"
                type="button"
                disabled={index === steps.length - 1}
                aria-label={copy("c331", { name })}
                onClick={() => onMove(index, 1)}
              >
                <Icon name="arrow_downward" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={copy("c332", { name })}
                onClick={() => onRemove(index)}
              >
                <Icon name="delete" />
              </button>
            </span>
          </article>
        );
      })}
    </fieldset>
  );
}
