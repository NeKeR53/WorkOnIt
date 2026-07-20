import { useTranslation } from "react-i18next";
import { copy } from "../i18n";
import { Icon } from "./Icon";
import { ThemeButton, type Theme } from "./ThemeButton";
import { LanguageSelect, type Language } from "./LanguageSelect";
import type { Board, Page } from "../lib/types";

const nav: Array<{ page: Page; icon: string }> = [
  { page: "boards", icon: "view_kanban" },
  { page: "sources", icon: "input_circle" },
  { page: "automations", icon: "automation" },
  { page: "history", icon: "history" },
];

export function Masthead({
  page,
  boards,
  activeBoardId,
  theme,
  language,
  onNavigate,
  onSelectBoard,
  onCreateBoard,
  onTheme,
  onLanguage,
}: {
  page: Page;
  boards: Board[];
  activeBoardId: string | undefined;
  theme: Theme;
  language: Language;
  onNavigate: (page: Page) => void;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: () => void;
  onTheme: (theme: Theme) => void;
  onLanguage: (language: Language) => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="masthead">
      <div className="brand-row">
        <strong>
          Work<span className="brand-accent">OnIt</span>
        </strong>
      </div>
      <nav className="header-tabs" aria-label={copy("c001")}>
        {nav.map((item) => (
          <div key={item.page}>
            <button
              className={page === item.page ? "nav-item active" : "nav-item"}
              aria-current={page === item.page ? "page" : undefined}
              onClick={() => onNavigate(item.page)}
            >
              <Icon name={item.icon} />
              <span>{t(`nav.${item.page}`)}</span>
            </button>
            {item.page === "boards" && boards.length > 0 && (
              <nav className="board-tabs" aria-label={copy("c003")}>
                {boards.map((entry) => (
                  <button
                    key={entry.id}
                    className={
                      entry.id === activeBoardId && page === "boards"
                        ? "board-tab active"
                        : "board-tab"
                    }
                    onClick={() => onSelectBoard(entry.id)}
                  >
                    {entry.name}
                  </button>
                ))}
                <button className="text-button" onClick={onCreateBoard}>
                  <Icon name="add" />
                  {copy("c004")}
                </button>
              </nav>
            )}
          </div>
        ))}
      </nav>
      <div className="masthead-tools">
        <button
          className={page === "archives" ? "icon-button active" : "icon-button"}
          aria-label={copy("c005")}
          aria-current={page === "archives" ? "page" : undefined}
          onClick={() => onNavigate("archives")}
        >
          <Icon name="inventory_2" />
          <span>{copy("c005")}</span>
        </button>
        <button
          className={page === "settings" ? "icon-button active" : "icon-button"}
          aria-label={copy("c006")}
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <Icon name="settings" />
          <span>{copy("c006")}</span>
        </button>
        <ThemeButton value={theme} onChange={onTheme} />
        <LanguageSelect value={language} onChange={onLanguage} />
      </div>
    </header>
  );
}
