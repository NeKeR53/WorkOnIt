import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { CommandAction } from "../../lib/backend-types";

export function ActionGrid({
  actions,
  onOpen,
  onCreate,
}: {
  actions: CommandAction[];
  onOpen: (action: CommandAction) => void;
  onCreate: () => void;
}) {
  return (
    <div className="action-grid" aria-label={copy("c126")}>
      {actions.map((item) => (
        <button
          className="action-grid-card"
          key={item.id}
          onClick={() => onOpen(item)}
        >
          <span className="action-grid-icon">
            <Icon name="terminal" />
          </span>
          <span className="action-grid-copy">
            {item.name}
            <small>{item.runner}</small>
          </span>
          <Icon name="arrow_forward" />
        </button>
      ))}
      <button className="action-grid-card action-grid-new" onClick={onCreate}>
        <span className="action-grid-icon">
          <Icon name="add" />
        </span>
        <span className="action-grid-copy">
          {copy("c125")}
          <small>{copy("c364")}</small>
        </span>
      </button>
    </div>
  );
}
