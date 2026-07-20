import { type ReactNode } from "react";

export function PageHeader({
  title,
  description,
  tools,
  actions,
}: {
  title: string;
  description?: string;
  tools?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="context-title">
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {tools}
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  );
}
