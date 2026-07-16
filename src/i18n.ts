import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import enCopy from "./locales/copy.en.json";
import frCopy from "./locales/copy.fr.json";

const language =
  localStorage.getItem("workonit.language") ??
  (navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en");

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en, copy: enCopy },
    fr: { translation: fr, copy: frCopy },
  },
  lng: language,
  fallbackLng: "fr",
  interpolation: { escapeValue: false },
});

export const copy = (
  key: string,
  options: Record<string, unknown> = {},
): string => i18n.t(key, { ns: "copy", ...options });

export default i18n;
