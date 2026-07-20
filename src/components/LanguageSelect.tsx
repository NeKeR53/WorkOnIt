import { copy } from "../i18n";
import { Icon } from "../components/Icon";

export type Language = "fr" | "en";

export function LanguageSelect({
  value,
  onChange,
}: {
  value: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <label className="theme-select">
      <span className="sr-only">{copy("c050")}</span>
      <Icon name="language" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Language)}
      >
        <option value="fr">{copy("c051")}</option>
        <option value="en">{copy("c052")}</option>
      </select>
    </label>
  );
}
