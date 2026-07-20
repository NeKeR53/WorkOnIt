import { copy } from "../i18n";
import { Icon } from "../components/Icon";

export type Theme = "system" | "light" | "dark";

export function ThemeButton({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
}) {
  const states: Theme[] = ["system", "light", "dark"];
  const labels: Record<Theme, string> = {
    system: copy("c047"),
    light: copy("c048"),
    dark: copy("c049"),
  };
  const icons: Record<Theme, string> = {
    system: "desktop_windows",
    light: "light_mode",
    dark: "dark_mode",
  };
  const next = states[(states.indexOf(value) + 1) % states.length];
  const label = `${copy("c007")} : ${labels[value]}`;

  return (
    <button
      type="button"
      className="icon-button theme-button"
      aria-label={label}
      title={`${label} · ${labels[next]}`}
      onClick={() => onChange(next)}
    >
      <Icon name={icons[value]} />
      <span>{labels[value]}</span>
    </button>
  );
}
