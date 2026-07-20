import { copy } from "../../i18n";

export type MappingTab = "raw" | "mapping" | "preview";

export function MappingTabs({
  value,
  onChange,
}: {
  value: MappingTab;
  onChange: (tab: MappingTab) => void;
}) {
  return (
    <div
      className="mapping-mobile-tabs"
      role="tablist"
      aria-label={copy("c097")}
    >
      {(["raw", "mapping", "preview"] as const).map((item) => (
        <button
          role="tab"
          aria-selected={value === item}
          className={value === item ? "active" : ""}
          key={item}
          onClick={() => onChange(item)}
        >
          {item === "raw"
            ? copy("c305")
            : item === "mapping"
              ? copy("c100")
              : copy("c114")}
        </button>
      ))}
    </div>
  );
}
