import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { SourceDefinition } from "../../lib/backend-types";

export function SourceList({
  sources,
  onOpen,
  onDelete,
}: {
  sources: SourceDefinition[];
  onOpen: (source: SourceDefinition) => void;
  onDelete: (source: SourceDefinition) => void;
}) {
  if (!sources.length) {
    return (
      <div className="empty-list">
        <Icon name="input_circle" />
        <p>{copy("c366")}</p>
      </div>
    );
  }
  return (
    <div className="source-list">
      {sources.map((item) => (
        <div className="source-list-item" key={item.id}>
          <button className="source-list-open" onClick={() => onOpen(item)}>
            <span>
              <Icon name="input_circle" />
              <strong>{item.name}</strong>
            </span>
            <span>
              {item.format.toUpperCase()}
              <Icon name="chevron_right" />
            </span>
          </button>
          <button
            className="icon-button danger"
            aria-label={copy("c372", { name: item.name })}
            onClick={() => onDelete(item)}
          >
            <Icon name="delete" />
          </button>
        </div>
      ))}
    </div>
  );
}
