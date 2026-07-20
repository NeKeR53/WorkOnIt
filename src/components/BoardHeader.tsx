import { useTranslation } from "react-i18next";
import { copy } from "../i18n";
import { Icon } from "./Icon";
import { PageHeader } from "./PageHeader";
import type { Board } from "../lib/types";

export function BoardHeader({
  board,
  search,
  onSearch,
  onOpenSettings,
  onNewTask,
}: {
  board: Board | undefined;
  search: string;
  onSearch: (search: string) => void;
  onOpenSettings: () => void;
  onNewTask: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={board ? board.name : "WorkOnIt"}
      tools={
        <label className="search-box">
          <Icon name="search" />
          <span className="sr-only">{copy("c008")}</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("app.search")}
          />

          <kbd>{navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
        </label>
      }
      actions={
        board && (
          <>
            <button className="secondary-button" onClick={onOpenSettings}>
              <Icon name="tune" />
              {copy("c009")}
            </button>
            <button className="primary-button" onClick={onNewTask}>
              <Icon name="add" /> {t("app.newTask")}
            </button>
          </>
        )
      }
    />
  );
}
