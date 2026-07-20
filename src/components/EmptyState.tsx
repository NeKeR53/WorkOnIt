import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/button";

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="empty-state">
      <div className="empty-illustration">
        <Icon name="view_kanban" />
      </div>
      <span className="eyebrow">{t("empty.eyebrow")}</span>
      <h2>{t("empty.title")}</h2>
      <p>{t("empty.description")}</p>
      <Button className="primary-button large" onClick={onCreate}>
        <Icon name="add" /> {t("empty.action")}
      </Button>
    </section>
  );
}
