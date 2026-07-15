import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { initialBoards, loadBoards, persistBoard } from "./lib/repository";
import { createBoard, createTask, type Board, type Page, type Task } from "./lib/types";
import "./styles.css";

type Dialog = "board" | "task" | null;
type Theme = "system" | "light" | "dark";

const nav: Array<{ page: Page; icon: string; label: string }> = [
  { page: "boards", icon: "view_kanban", label: "Kanbans" },
  { page: "sources", icon: "input_circle", label: "Sources" },
  { page: "automations", icon: "automation", label: "Automatisations" },
  { page: "history", icon: "history", label: "Historique" },
];

export default function App() {
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [boardId, setBoardId] = useState(() => initialBoards()[0]?.id ?? "");
  const [page, setPage] = useState<Page>("boards");
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("workonit.sidebar") !== "closed");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [taskColumnId, setTaskColumnId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("workonit.theme") as Theme) || "system");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const board = boards.find((candidate) => candidate.id === boardId) ?? boards[0];
  const selectedTask = board?.tasks.find((task) => task.id === selectedTaskId) ?? null;

  useEffect(() => {
    loadBoards().then((loaded) => {
      if (loaded.length) {
        setBoards(loaded);
        setBoardId((current) => current || loaded[0].id);
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("workonit.theme", theme);
  }, [theme]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setDialog(null);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);

  const save = (changed: Board) => {
    const stamped = { ...changed, updatedAt: new Date().toISOString() };
    setBoards((current) => current.map((item) => (item.id === stamped.id ? stamped : item)));
    void persistBoard(stamped).catch(() => setToast("Impossible d’enregistrer les changements"));
  };

  const addBoard = (name: string) => {
    const next = createBoard(name);
    setBoards((current) => [...current, next]);
    setBoardId(next.id);
    setPage("boards");
    setDialog(null);
    void persistBoard(next);
  };

  const addTask = (title: string) => {
    if (!board || !taskColumnId) return;
    const position = board.tasks.filter((task) => task.columnId === taskColumnId && !task.archived).length;
    const task = createTask(title, taskColumnId, position);
    save({ ...board, tasks: [...board.tasks, task] });
    setDialog(null);
    setSelectedTaskId(task.id);
  };

  const updateTask = (task: Task) => {
    if (!board) return;
    save({ ...board, tasks: board.tasks.map((item) => (item.id === task.id ? task : item)) });
  };

  const moveTask = (taskId: string, target: string) => {
    if (!board) return;
    const task = board.tasks.find((candidate) => candidate.id === taskId);
    const column = board.columns.find((candidate) => candidate.id === target);
    if (!task || !column || task.columnId === target) return;
    const allowed = !board.transitionsRestricted || board.allowedTransitions.some(
      (transition) => transition.fromColumnId === task.columnId && transition.toColumnId === target,
    );
    if (!allowed) {
      setToast(`Transition vers « ${column.name} » non autorisée`);
      return;
    }
    if (column.wipPolicy.kind === "hard") {
      const count = board.tasks.filter((item) => item.columnId === target && !item.archived).length;
      if (count >= column.wipPolicy.limit) {
        setToast(`Limite de ${column.wipPolicy.limit} tâche(s) atteinte dans « ${column.name} »`);
        return;
      }
    }
    const moved: Task = {
      ...task,
      columnId: target,
      position: board.tasks.filter((item) => item.columnId === target && !item.archived).length,
      updatedAt: new Date().toISOString(),
      history: [...task.history, {
        fromColumnId: task.columnId,
        toColumnId: target,
        origin: "user",
        occurredAt: new Date().toISOString(),
      }],
    };
    updateTask(moved);
  };

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? "sidebar" : "sidebar collapsed"} aria-label="Navigation principale">
        <div className="brand-row">
          <div className="brand-mark"><Icon name="done_all" /></div>
          {sidebarOpen && <strong>WorkOnIt</strong>}
          <button
            className="icon-button collapse-button"
            aria-label={sidebarOpen ? "Rétracter la navigation" : "Restaurer la navigation"}
            onClick={() => {
              const next = !sidebarOpen;
              setSidebarOpen(next);
              localStorage.setItem("workonit.sidebar", next ? "open" : "closed");
            }}
          ><Icon name={sidebarOpen ? "left_panel_close" : "left_panel_open"} /></button>
        </div>
        <nav>
          {nav.map((item) => (
            <button key={item.page} className={page === item.page ? "nav-item active" : "nav-item"} onClick={() => { setPage(item.page); setSelectedTaskId(null); }}>
              <Icon name={item.icon} />{sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} />{sidebarOpen && <span>Thème</span>}
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="context-title">
            <span className="eyebrow">{page === "boards" ? "Kanban" : nav.find((item) => item.page === page)?.label}</span>
            <h1>{page === "boards" ? board?.name ?? "WorkOnIt" : nav.find((item) => item.page === page)?.label}</h1>
          </div>
          <label className="search-box">
            <Icon name="search" />
            <span className="sr-only">Rechercher</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher…" />
            <kbd>⌘K</kbd>
          </label>
          <ThemeSelect value={theme} onChange={setTheme} />
          {page === "boards" && board && (
            <button className="primary-button" onClick={() => { setTaskColumnId(board.columns[0].id); setDialog("task"); }}>
              <Icon name="add" /> Nouvelle tâche
            </button>
          )}
        </header>

        {page === "boards" && (
          !board ? <EmptyState onCreate={() => setDialog("board")} /> : (
            <BoardView
              board={board}
              search={search}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onAddTask={(columnId) => { setTaskColumnId(columnId); setDialog("task"); }}
              onMoveTask={moveTask}
            />
          )
        )}
        {page === "sources" && <SourcesPage board={board} onImport={(tasks) => board && save({ ...board, tasks: [...board.tasks, ...tasks] })} />}
        {page === "automations" && <AutomationsPage />}
        {page === "history" && <HistoryPage boards={boards} />}
      </main>

      {selectedTask && board && (
        <TaskPanel
          task={selectedTask}
          board={board}
          onClose={() => setSelectedTaskId(null)}
          onChange={updateTask}
          onMove={(columnId) => moveTask(selectedTask.id, columnId)}
          onArchive={() => {
            updateTask({ ...selectedTask, archived: true, updatedAt: new Date().toISOString() });
            setSelectedTaskId(null);
            setToast("Tâche archivée");
          }}
        />
      )}

      {dialog === "board" && <CreateDialog kind="board" onClose={() => setDialog(null)} onSubmit={addBoard} />}
      {dialog === "task" && <CreateDialog kind="task" onClose={() => setDialog(null)} onSubmit={addTask} />}
      {paletteOpen && <CommandPalette boards={boards} onClose={() => setPaletteOpen(false)} onOpen={(nextBoard, task) => {
        setBoardId(nextBoard.id); setPage("boards"); setSelectedTaskId(task?.id ?? null); setPaletteOpen(false);
      }} />}
      {toast && <div className="snackbar" role="alert">{toast}<button onClick={() => setToast(null)} aria-label="Fermer"><Icon name="close" /></button></div>}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <section className="empty-state">
    <div className="empty-illustration"><Icon name="view_kanban" /></div>
    <span className="eyebrow">Premier espace</span>
    <h2>Organisez le travail à votre façon</h2>
    <p>Créez un kanban local, adaptez ses colonnes puis automatisez vos transitions quand vous êtes prêt.</p>
    <button className="primary-button large" onClick={onCreate}><Icon name="add" /> Créer un kanban</button>
  </section>;
}

function BoardView({ board, search, selectedTaskId, onSelectTask, onAddTask, onMoveTask }: {
  board: Board; search: string; selectedTaskId: string | null;
  onSelectTask: (id: string) => void; onAddTask: (columnId: string) => void;
  onMoveTask: (taskId: string, columnId: string) => void;
}) {
  const filtered = useMemo(() => board.tasks.filter((task) => !task.archived && `${task.title} ${task.description} ${task.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase())), [board.tasks, search]);
  return <section className="board-scroll" aria-label={`Kanban ${board.name}`}>
    <div className="board-grid">
      {board.columns.sort((a, b) => a.position - b.position).map((column) => {
        const tasks = filtered.filter((task) => task.columnId === column.id).sort((a, b) => a.position - b.position);
        const warning = column.wipPolicy.kind !== "none" && tasks.length >= column.wipPolicy.limit;
        return <section
          className="kanban-column"
          key={column.id}
          role="region"
          aria-label={column.name}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onMoveTask(event.dataTransfer.getData("text/task-id"), column.id)}
        >
          <header className="column-header" style={{ "--column-color": column.color } as React.CSSProperties}>
            <div><h2>{column.name}</h2><span className="count-badge">{tasks.length}</span></div>
            <button className="icon-button" aria-label={`Options de ${column.name}`}><Icon name="more_horiz" /></button>
          </header>
          {warning && <p className="wip-warning"><Icon name="warning" /> Limite {column.wipPolicy.kind === "hard" ? "atteinte" : "conseillée atteinte"}</p>}
          <div className="card-list">
            {tasks.map((task) => <TaskCard key={task.id} task={task} selected={selectedTaskId === task.id} onSelect={() => onSelectTask(task.id)} />)}
            {!tasks.length && <div className="column-empty"><Icon name="inbox" /><span>Déposez une tâche ici</span></div>}
          </div>
          <button className="add-task-button" aria-label={`Ajouter une tâche dans ${column.name}`} onClick={() => onAddTask(column.id)}><Icon name="add" /> Ajouter une tâche</button>
        </section>;
      })}
    </div>
  </section>;
}

function TaskCard({ task, selected, onSelect }: { task: Task; selected: boolean; onSelect: () => void }) {
  const running = typeof task.executionStatus === "object" ? task.executionStatus.running : null;
  return <article className={selected ? "task-card selected" : "task-card"} draggable onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}>
    <button className="task-card-main" onClick={onSelect} aria-label={task.title}>
      <span className="task-title">{task.title}</span>
      {task.description && <span className="task-description">{task.description}</span>}
      <span className="task-meta">
        {task.priority && <span><Icon name="flag" />{task.priority}</span>}
        {task.dueDate && <span><Icon name="event" />{new Date(task.dueDate).toLocaleDateString("fr-FR")}</span>}
      </span>
      {!!task.tags.length && <span className="tag-row">{task.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</span>}
      {task.executionStatus !== "idle" && <span className={`status-badge status-${typeof task.executionStatus === "string" ? task.executionStatus : "running"}`}>
        <Icon name={task.executionStatus === "failed" ? "error" : running ? "sync" : "check_circle"} />
        {task.executionStatus === "failed" ? "Échec" : running ? `En cours ${running.step}/${running.total}` : "Succès"}
      </span>}
    </button>
  </article>;
}

function TaskPanel({ task, board, onClose, onChange, onMove, onArchive }: {
  task: Task; board: Board; onClose: () => void; onChange: (task: Task) => void; onMove: (id: string) => void; onArchive: () => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  return <aside className="detail-panel" aria-label={`Détail de ${task.title}`}>
    <header><div><span className="eyebrow">Tâche</span><h2>Détails</h2></div><button className="icon-button" onClick={onClose} aria-label="Fermer le détail"><Icon name="close" /></button></header>
    <div className="panel-body">
      <label>Titre<input value={task.title} onChange={(event) => onChange({ ...task, title: event.target.value })} /></label>
      <label>Description<textarea rows={5} value={task.description} placeholder="Ajoutez du contexte…" onChange={(event) => onChange({ ...task, description: event.target.value })} /></label>
      <div className="field-grid">
        <label>Priorité<select value={task.priority ?? "Normale"} onChange={(event) => onChange({ ...task, priority: event.target.value as Task["priority"] })}><option>Basse</option><option>Normale</option><option>Haute</option></select></label>
        <label>Échéance<input type="date" value={task.dueDate ?? ""} onChange={(event) => onChange({ ...task, dueDate: event.target.value })} /></label>
      </div>
      <label>Tags<input value={task.tags.join(", ")} placeholder="design, urgent" onChange={(event) => onChange({ ...task, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></label>
      <label>Notes<textarea rows={4} value={task.notes} onChange={(event) => onChange({ ...task, notes: event.target.value })} /></label>
      {task.history.length > 0 && <section className="history-snippet"><h3>Dernier déplacement</h3><p><Icon name="swap_horiz" /> {new Date(task.history.at(-1)!.occurredAt).toLocaleString("fr-FR")}</p></section>}
    </div>
    <footer>
      <div className="move-control">
        <button className="secondary-button" onClick={() => setMoveOpen(!moveOpen)}><Icon name="drive_file_move" /> Déplacer vers…</button>
        {moveOpen && <div className="move-menu" role="menu">{board.columns.filter((column) => column.id !== task.columnId).map((column) => <button role="menuitem" key={column.id} onClick={() => { onMove(column.id); setMoveOpen(false); }}>{column.name}</button>)}</div>}
      </div>
      <button className="text-button danger" onClick={onArchive}><Icon name="archive" /> Archiver</button>
    </footer>
  </aside>;
}

function CreateDialog({ kind, onClose, onSubmit }: { kind: "board" | "task"; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const isBoard = kind === "board";
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name); }}>
      <header><div className="dialog-icon"><Icon name={isBoard ? "view_kanban" : "add_task"} /></div><div><span className="eyebrow">Nouveau</span><h2 id="dialog-title">{isBoard ? "Créer un kanban" : "Ajouter une tâche"}</h2></div></header>
      <label>{isBoard ? "Nom du kanban" : "Titre"}<input ref={input} value={name} onChange={(event) => setName(event.target.value)} placeholder={isBoard ? "Ex. Produit" : "Que faut-il accomplir ?"} /></label>
      {isBoard && <p className="field-help">Trois colonnes seront créées. Vous pourrez les adapter ensuite.</p>}
      <footer><button type="button" className="text-button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={!name.trim()}>{isBoard ? "Créer le kanban" : "Ajouter la tâche"}</button></footer>
    </form>
  </div>;
}

function ThemeSelect({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return <label className="theme-select"><span className="sr-only">Thème</span><Icon name="contrast" /><select value={value} onChange={(event) => onChange(event.target.value as Theme)}><option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option></select></label>;
}

function CommandPalette({ boards, onClose, onOpen }: { boards: Board[]; onClose: () => void; onOpen: (board: Board, task?: Task) => void }) {
  const [query, setQuery] = useState("");
  const results: Array<{ board: Board; task?: Task; label: string; kind: string }> = boards.flatMap((board) => [
    { board, task: undefined, label: board.name, kind: "Kanban" },
    ...board.tasks.filter((task) => !task.archived).map((task) => ({ board, task, label: task.title, kind: "Tâche" })),
  ]).filter((result) => result.label.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  return <div className="dialog-backdrop"><div className="command-palette" role="dialog" aria-modal="true" aria-label="Palette globale">
    <label><Icon name="search" /><span className="sr-only">Rechercher partout</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kanbans, tâches, actions, sources…" /><button className="key-button" onClick={onClose}>Esc</button></label>
    <div className="palette-results">{results.map((result) => <button key={`${result.kind}-${result.label}`} onClick={() => onOpen(result.board, result.task)}><span><Icon name={result.kind === "Kanban" ? "view_kanban" : "task_alt"} />{result.label}</span><small>{result.kind} · {result.board.name}</small></button>)}{!results.length && <p>Aucun résultat</p>}</div>
  </div></div>;
}

function SourcesPage({ board, onImport }: { board?: Board; onImport: (tasks: Task[]) => void }) {
  const [raw, setRaw] = useState('[\n  { "id": "42", "title": "Exemple à importer" }\n]');
  const [preview, setPreview] = useState<Array<{ id?: string; title: string }> | null>(null);
  const [error, setError] = useState("");
  const parse = () => { try { const value = JSON.parse(raw); const records = Array.isArray(value) ? value : [value]; setPreview(records.filter((item) => typeof item.title === "string")); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "JSON invalide"); setPreview(null); } };
  const apply = () => {
    if (!board || !preview) return;
    const column = board.columns[0];
    const tasks = preview.map((record, position) => ({ ...createTask(record.title, column.id, board.tasks.length + position), externalKey: record.id, sourceName: "Import manuel" }));
    onImport(tasks); setPreview(null);
  };
  return <section className="content-page"><header><div><span className="eyebrow">Collecte locale</span><h2>Sources de tâches</h2><p>Transformez une sortie JSON, JSONL ou texte en tâches vérifiables avant import.</p></div><button className="primary-button"><Icon name="add" /> Nouvelle source</button></header>
    <div className="mapping-grid"><section className="editor-pane"><div className="pane-title"><strong>Sortie brute</strong><span>JSON</span></div><textarea aria-label="Sortie brute" spellCheck={false} value={raw} onChange={(event) => setRaw(event.target.value)} />{error && <p className="inline-error"><Icon name="error" />{error}</p>}</section><section className="mapping-pane"><div className="pane-title"><strong>Mapping</strong><span>Chemins</span></div><label>Titre<input value="$.title" readOnly /></label><label>Clé externe<input value="$.id" readOnly /></label><button className="secondary-button" onClick={parse}><Icon name="preview" /> Prévisualiser</button></section><section className="preview-pane"><div className="pane-title"><strong>Aperçu</strong><span>{preview?.length ?? 0} tâches</span></div>{preview?.map((record, index) => <div className="preview-task" key={`${record.id}-${index}`}><Icon name="task_alt" /><span>{record.title}<small>{record.id ?? "Sans clé externe"}</small></span></div>)}{!preview && <div className="pane-empty"><Icon name="visibility" /><p>L’aperçu apparaîtra ici.</p></div>}{preview && <button className="primary-button" onClick={apply}>Importer {preview.length} tâche(s)</button>}</section></div>
  </section>;
}

function AutomationsPage() {
  const [tab, setTab] = useState("Commande");
  const [script, setScript] = useState('deploy "$WORKONIT_TITLE"');
  return <section className="content-page"><header><div><span className="eyebrow">Bibliothèque globale</span><h2>Automatisations</h2><p>Composez des actions explicites, testables et compatibles avec chaque système.</p></div><button className="primary-button"><Icon name="add" /> Nouvelle action</button></header>
    <div className="automation-card"><div className="automation-heading"><div className="automation-icon"><Icon name="terminal" /></div><div><h3>Publier la tâche</h3><p>macOS · zsh · brouillon</p></div><span className="draft-badge">Brouillon</span></div><div className="tabs" role="tablist">{["Commande", "Contexte", "Conditions", "Test"].map((item) => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Commande" ? <div className="code-editor"><div className="code-meta"><span>zsh · macOS</span><button><Icon name="data_object" /> Insérer une variable</button></div><div><span className="line-number">1</span><textarea aria-label="Commande shell" value={script} onChange={(event) => setScript(event.target.value)} /></div></div> : <div className="tab-placeholder"><Icon name={tab === "Test" ? "science" : "tune"} /><h4>{tab}</h4><p>{tab === "Test" ? "Prévisualisez variables et paramètres avant toute exécution réelle." : "Configuration guidée disponible pour cette action."}</p></div>}<footer><button className="secondary-button"><Icon name="preview" /> Prévisualiser</button><button className="primary-button"><Icon name="publish" /> Enregistrer et activer</button></footer></div>
  </section>;
}

function HistoryPage({ boards }: { boards: Board[] }) {
  const records = boards.flatMap((board) => board.tasks.flatMap((task) => task.history.map((history) => ({ board, task, history })))).sort((a, b) => b.history.occurredAt.localeCompare(a.history.occurredAt));
  return <section className="content-page"><header><div><span className="eyebrow">Journal local</span><h2>Historique</h2><p>Transitions et exécutions restent consultables sans masquer vos données.</p></div></header><div className="history-list">{records.map(({ board, task, history }) => <article key={history.occurredAt + task.id}><div className="timeline-icon"><Icon name="swap_horiz" /></div><div><h3>{task.title}</h3><p>Déplacée dans {board.columns.find((column) => column.id === history.toColumnId)?.name} · {board.name}</p></div><time>{new Date(history.occurredAt).toLocaleString("fr-FR")}</time></article>)}{!records.length && <div className="history-empty"><Icon name="history" /><h3>Aucune activité</h3><p>Les transitions et exécutions apparaîtront ici.</p></div>}</div></section>;
}
