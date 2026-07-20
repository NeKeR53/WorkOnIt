import { useEffect, useRef, useState } from "react";
import { copy } from "../i18n";
import { Icon } from "../components/Icon";

export function CreateDialog({
  kind,
  onClose,
  onSubmit,
}: {
  kind: "board" | "task";
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const isBoard = kind === "board";
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSubmit(name);
        }}
      >
        <header>
          <div className="dialog-icon">
            <Icon name={isBoard ? "view_kanban" : "add_task"} />
          </div>
          <div>
            <span className="eyebrow">{copy("c045")}</span>
            <h2 id="dialog-title">{isBoard ? copy("c262") : copy("c263")}</h2>
          </div>
        </header>
        <label>
          {isBoard ? "Nom du kanban" : "Titre"}
          <input
            ref={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={isBoard ? "Ex. Produit" : "Que faut-il accomplir ?"}
          />
        </label>
        {isBoard && <p className="field-help">{copy("c046")}</p>}
        <footer>
          <button type="button" className="text-button" onClick={onClose}>
            {copy("c012")}
          </button>
          <button className="primary-button" disabled={!name.trim()}>
            {isBoard ? copy("c264") : copy("c265")}
          </button>
        </footer>
      </form>
    </div>
  );
}
