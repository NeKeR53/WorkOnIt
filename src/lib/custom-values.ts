import { copy } from "../i18n";
import type { CustomFieldValue } from "./types";

export function customValueText(value: CustomFieldValue): string {
  if (value.kind === "secretRef") return copy("c260");
  if (value.kind === "boolean")
    return value.value ? copy("c317") : copy("c318");
  return String(value.value);
}
