import { copy } from "../../i18n";
import { Icon } from "../Icon";
import type { SourceDefinition, SourcePreview } from "../../lib/backend-types";

export function RawPane({
  raw,
  format,
  errors,
  active,
  onChange,
}: {
  raw: string;
  format: SourceDefinition["format"];
  errors: SourcePreview["errors"] | undefined;
  active: boolean;
  onChange: (raw: string) => void;
}) {
  return (
    <section className={active ? "editor-pane mobile-active" : "editor-pane"}>
      <div className="pane-title">
        <strong>{copy("c098")}</strong>
        <span>{format.toUpperCase()}</span>
      </div>
      <textarea
        aria-label={copy("c098")}
        spellCheck={false}
        value={raw}
        onChange={(event) => onChange(event.target.value)}
      />

      {errors?.map((error) => (
        <p className="inline-error" key={`${error.line}-${error.message}`}>
          <Icon name="error" />
          {copy("c099")}
          {error.line}: {error.message}
        </p>
      ))}
    </section>
  );
}
