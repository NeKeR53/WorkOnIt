import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { copy } from "./i18n";
import { Icon } from "./components/Icon";
import { Button } from "./components/ui/button";
import {
  addColumnInRepository,
  addCustomFieldInRepository,
  addTaskInRepository,
  abandonExecutionInRepository,
  activateAutomationDraft,
  applySourceResult,
  applyImportFile,
  archiveTaskInRepository,
  cancelTaskExecution,
  cancelSourceExecution,
  createBackup,
  createBoardInRepository,
  configureColumnInRepository,
  deleteColumnInRepository,
  deleteTaskPermanently,
  getSetting,
  initialBoards,
  inspectSourceNow,
  isDesktopRuntime,
  loadBoards,
  listBackups,
  loadActions,
  loadAutomationDrafts,
  loadExecutions,
  loadSchedulerJournal,
  loadSources,
  loadTriggers,
  moveTaskOnBackend,
  newCommandAction,
  newSource,
  persistBoard,
  previewSourceInRepository,
  previewAutomationDraft,
  previewImportConflicts,
  previewImportFile,
  restoreBackup,
  restoreTaskInRepository,
  reorderTaskInRepository,
  resumeExecutionInRepository,
  saveActionInRepository,
  saveAutomationDraftInRepository,
  saveSourceInRepository,
  saveTriggerInRepository,
  setSetting,
  setCustomValueInRepository,
  setSecret,
  setTransitionRulesInRepository,
  takePendingImports,
  testAutomationDraft,
  trustImportedCommands,
  updateTaskInRepository,
  writeExportFile,
  type SettingKey,
} from "./lib/repository";
import {
  createTask,
  type Board,
  type CustomFieldValue,
  type FieldKind,
  type Page,
  type Task,
  type WipPolicy,
} from "./lib/types";
import type {
  ActionCondition,
  ActionStep,
  AutomationDraft,
  BackupInfo,
  CommandAction,
  CommandPreview,
  ExecutionRecord,
  SchedulerJournalEntry,
  ImportConflict,
  ImportResult,
  SourceDefinition,
  SourcePreview,
  TriggerDefinition,
  TransitionAutomation,
} from "./lib/backend-types";
import "./styles.css";

type Dialog = "board" | "task" | null;
type Theme = "system" | "light" | "dark";
type Language = "fr" | "en";

const nav: Array<{ page: Page; icon: string }> = [
  { page: "boards", icon: "view_kanban" },
  { page: "sources", icon: "input_circle" },
  { page: "automations", icon: "automation" },
  { page: "history", icon: "history" },
];

export default function App() {
  useDialogFocusTrap();
  const { t, i18n } = useTranslation();
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [boardId, setBoardId] = useState(() => initialBoards()[0]?.id ?? "");
  const [page, setPage] = useState<Page>("boards");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("workonit.sidebar") !== "closed",
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [taskColumnId, setTaskColumnId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("workonit.theme") as Theme) || "system",
  );
  const [language, setLanguage] = useState<Language>(
    () =>
      (localStorage.getItem("workonit.language") as Language) ||
      (navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en"),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(
    null,
  );
  const [pendingMove, setPendingMove] = useState<{
    taskId: string;
    target: string;
  } | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(isDesktopRuntime());

  const board =
    boards.find((candidate) => candidate.id === boardId) ?? boards[0];
  const selectedTask =
    board?.tasks.find((task) => task.id === selectedTaskId) ?? null;

  useEffect(() => {
    const refresh = () => {
      setLoading(true);
      loadBoards()
        .then((loaded) => {
          if (loaded.length) {
            setBoards(loaded);
            setBoardId((current) => current || loaded[0].id);
          }
          setRetry(null);
        })
        .catch((error: unknown) => {
          setToast(copy("c298", { error: String(error) }));
          setRetry(() => refresh);
        })
        .finally(() => setLoading(false));
    };
    refresh();
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ taskId: string; step: number; total: number }>(
      "execution-progress",
      ({ payload }) => {
        setBoards((current) =>
          current.map((item) => ({
            ...item,
            tasks: item.tasks.map((task) =>
              task.id === payload.taskId
                ? {
                    ...task,
                    executionStatus: {
                      running: {
                        step: payload.step,
                        total: payload.total,
                      },
                    },
                  }
                : task,
            ),
          })),
        );
      },
    ).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    void takePendingImports().then((paths) => {
      if (paths[0]) {
        setPendingImportPath(paths[0]);
        setSettingsOpen(true);
      }
    });
    if (!isDesktopRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<string[]>("import-file-requested", ({ payload }) => {
      if (payload[0]) {
        setPendingImportPath(payload[0]);
        setSettingsOpen(true);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    localStorage.setItem("workonit.theme", theme);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media?.matches ? "dark" : "light") : theme;
    };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("workonit.language", language);
    void i18n.changeLanguage(language);
  }, [i18n, language]);

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
    setBoards((current) => {
      const index = current.findIndex((item) => item.id === stamped.id);
      return [...current.slice(0, index), stamped, ...current.slice(index + 1)];
    });
    void persistBoard(stamped).catch(() => setToast(copy("c299")));
  };

  const replaceBoard = (updated: Board) => {
    setBoards((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  };

  const addBoard = (name: string) => {
    void createBoardInRepository(name)
      .then((next) => {
        setBoards((current) => [...current, next]);
        setBoardId(next.id);
        setPage("boards");
        setDialog(null);
      })
      .catch((error: unknown) => setToast(String(error)));
  };

  const addTask = (title: string) => {
    const currentBoard = board!;
    void addTaskInRepository(currentBoard, taskColumnId, title)
      .then((updated) => {
        replaceBoard(updated);
        setDialog(null);
        setSelectedTaskId(updated.tasks.at(-1)!.id);
      })
      .catch((error: unknown) => setToast(String(error)));
  };

  const updateTask = (task: Task) => {
    const currentBoard = board!;
    replaceBoard({
      ...currentBoard,
      tasks: currentBoard.tasks.map((item) =>
        item.id === task.id ? task : item,
      ),
    });
    void updateTaskInRepository(currentBoard, task)
      .then(replaceBoard)
      .catch((error: unknown) => setToast(String(error)));
  };

  const reorderTask = (taskId: string, position: number) => {
    void reorderTaskInRepository(board!, taskId, position)
      .then(replaceBoard)
      .catch((error: unknown) => setToast(String(error)));
  };

  const moveTask = (taskId: string, target: string, confirmed = false) => {
    const currentBoard = board!;
    if (isDesktopRuntime()) {
      void moveTaskOnBackend(currentBoard.id, taskId, target, confirmed)
        .then((updated) => {
          setBoards((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
        })
        .catch((error: unknown) => {
          replaceBoard(currentBoard);
          const message = String(error);
          if (message.toLowerCase().includes("confirmation"))
            setPendingMove({ taskId, target });
          else setToast(message);
        });
      return;
    }
    const task = currentBoard.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    const column = currentBoard.columns.find(
      (candidate) => candidate.id === target,
    );
    if (!task || !column || task.columnId === target) return;
    const allowed =
      !currentBoard.transitionsRestricted ||
      currentBoard.allowedTransitions.some(
        (transition) =>
          transition.fromColumnId === task.columnId &&
          transition.toColumnId === target,
      );
    if (!allowed) {
      setToast(copy("c251", { name: column.name }));
      return;
    }
    if (column.wipPolicy.kind === "hard") {
      const count = currentBoard.tasks.filter(
        (item) => item.columnId === target && !item.archived,
      ).length;
      if (count >= column.wipPolicy.limit) {
        setToast(
          copy("c252", { count: column.wipPolicy.limit, name: column.name }),
        );
        return;
      }
    }
    const moved: Task = {
      ...task,
      columnId: target,
      position: currentBoard.tasks.filter(
        (item) => item.columnId === target && !item.archived,
      ).length,
      updatedAt: new Date().toISOString(),
      history: [
        ...task.history,
        {
          fromColumnId: task.columnId,
          toColumnId: target,
          origin: "user",
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    updateTask(moved);
  };

  return (
    <div className="app-shell">
      <aside
        className={sidebarOpen ? "sidebar" : "sidebar collapsed"}
        aria-label={copy("c001")}
      >
        <div className="brand-row">
          <div className="brand-mark">
            <Icon name="done_all" />
          </div>
          {sidebarOpen && <strong>{copy("c002")}</strong>}
          <button
            className="icon-button collapse-button"
            aria-label={sidebarOpen ? copy("c248") : copy("c249")}
            onClick={() => {
              const next = !sidebarOpen;
              setSidebarOpen(next);
              localStorage.setItem(
                "workonit.sidebar",
                next ? "open" : "closed",
              );
            }}
          >
            <Icon name={sidebarOpen ? "left_panel_close" : "left_panel_open"} />
          </button>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.page}
              className={page === item.page ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPage(item.page);
                setSelectedTaskId(null);
              }}
            >
              <Icon name={item.icon} />
              {sidebarOpen && <span>{t(`nav.${item.page}`)}</span>}
            </button>
          ))}
          {sidebarOpen && (
            <div className="board-nav-list" aria-label={copy("c003")}>
              {boards.map((item) => (
                <button
                  className={
                    page === "boards" && item.id === board?.id
                      ? "board-nav active"
                      : "board-nav"
                  }
                  key={item.id}
                  onClick={() => {
                    setBoardId(item.id);
                    setPage("boards");
                  }}
                >
                  {item.name}
                </button>
              ))}
              <button
                className="board-nav add"
                onClick={() => setDialog("board")}
              >
                <Icon name="add" />
                {copy("c004")}
              </button>
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => setArchivesOpen(true)}>
            <Icon name="inventory_2" />
            {sidebarOpen && <span>{copy("c005")}</span>}
          </button>
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
            {sidebarOpen && <span>{copy("c006")}</span>}
          </button>
          <button
            className="nav-item"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} />
            {sidebarOpen && <span>{copy("c007")}</span>}
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="context-title">
            <span className="eyebrow">
              {page === "boards" ? copy("c250") : t(`nav.${page}`)}
            </span>
            <h1>
              {page === "boards"
                ? (board?.name ?? "WorkOnIt")
                : t(`nav.${page}`)}
            </h1>
          </div>
          <label className="search-box">
            <Icon name="search" />
            <span className="sr-only">{copy("c008")}</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("app.search")}
            />

            <kbd>{navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
          </label>
          <ThemeSelect value={theme} onChange={setTheme} />
          <LanguageSelect value={language} onChange={setLanguage} />
          {page === "boards" && board && (
            <div className="topbar-actions">
              <button
                className="secondary-button"
                onClick={() => setBoardSettingsOpen(true)}
              >
                <Icon name="tune" />
                {copy("c009")}
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setTaskColumnId(board.columns[0].id);
                  setDialog("task");
                }}
              >
                <Icon name="add" /> {t("app.newTask")}
              </button>
            </div>
          )}
        </header>

        {page === "boards" &&
          (loading ? (
            <BoardSkeleton />
          ) : !board ? (
            <EmptyState onCreate={() => setDialog("board")} />
          ) : (
            <BoardView
              board={board}
              search={search}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onAddTask={(columnId) => {
                setTaskColumnId(columnId);
                setDialog("task");
              }}
              onMoveTask={moveTask}
              onReorderTask={reorderTask}
              onConfigureColumn={setSelectedColumnId}
            />
          ))}
        {page === "sources" && board && (
          <SourcesPage
            board={board}
            onImport={(tasks) =>
              save({ ...board, tasks: [...board.tasks, ...tasks] })
            }
            onBoard={replaceBoard}
            onMessage={setToast}
          />
        )}
        {page === "automations" && board && (
          <AutomationsPage board={board} onMessage={setToast} />
        )}
        {page === "history" && (
          <HistoryPage
            boards={boards}
            onBoards={setBoards}
            onMessage={setToast}
          />
        )}
      </main>

      {selectedTask && board && (
        <TaskPanel
          task={selectedTask}
          board={board}
          onClose={() => setSelectedTaskId(null)}
          onChange={updateTask}
          onMove={(columnId) => moveTask(selectedTask.id, columnId)}
          onArchive={() => {
            void archiveTaskInRepository(board, selectedTask.id)
              .then(replaceBoard)
              .catch((error: unknown) => setToast(String(error)));
            setSelectedTaskId(null);
            setToast(copy("c253"));
          }}
          onOpenFailure={() => {
            setSelectedTaskId(null);
            setPage("history");
          }}
          onCancel={() =>
            void cancelTaskExecution(selectedTask.id).then(() =>
              setToast(copy("c254")),
            )
          }
          onCustom={(fieldId, value) =>
            void setCustomValueInRepository(
              board,
              selectedTask.id,
              fieldId,
              value,
            )
              .then(replaceBoard)
              .catch((error: unknown) => setToast(String(error)))
          }
        />
      )}
      {selectedColumnId && board && (
        <ColumnPanel
          board={board}
          columnId={selectedColumnId}
          onBoard={replaceBoard}
          onClose={() => setSelectedColumnId(null)}
          onMessage={setToast}
        />
      )}
      {boardSettingsOpen && board && (
        <BoardSettingsDialog
          board={board}
          onBoard={replaceBoard}
          onClose={() => setBoardSettingsOpen(false)}
          onMessage={setToast}
        />
      )}

      {dialog === "board" && (
        <CreateDialog
          kind="board"
          onClose={() => setDialog(null)}
          onSubmit={addBoard}
        />
      )}
      {dialog === "task" && (
        <CreateDialog
          kind="task"
          onClose={() => setDialog(null)}
          onSubmit={addTask}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          boards={boards}
          onClose={() => setPaletteOpen(false)}
          onOpen={(nextPage, nextBoard, task) => {
            if (nextBoard) setBoardId(nextBoard.id);
            setPage(nextPage);
            setSelectedTaskId(task?.id ?? null);
            setPaletteOpen(false);
          }}
        />
      )}
      {archivesOpen && (
        <ArchivesDialog
          boards={boards}
          onBoards={setBoards}
          onClose={() => setArchivesOpen(false)}
          onMessage={setToast}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          boards={boards}
          pendingImportPath={pendingImportPath}
          onClose={() => {
            setSettingsOpen(false);
            setPendingImportPath(null);
          }}
          onBoards={(updated) => {
            setBoards(updated);
            setBoardId(updated[0]?.id ?? "");
          }}
          onMessage={setToast}
        />
      )}
      {pendingMove && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={copy("c010")}
          >
            <h2>{copy("c010")}</h2>
            <p>{copy("c011")}</p>
            <footer>
              <button
                className="text-button"
                onClick={() => setPendingMove(null)}
              >
                {copy("c012")}
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  moveTask(pendingMove.taskId, pendingMove.target, true);
                  setPendingMove(null);
                }}
              >
                {copy("c013")}
              </button>
            </footer>
          </div>
        </div>
      )}
      {toast && (
        <div className="snackbar" role="alert">
          {toast}
          {retry && (
            <button
              onClick={() => {
                setToast(null);
                retry();
              }}
            >
              {copy("c014")}
            </button>
          )}
          <button
            onClick={() => {
              setToast(null);
              setRetry(null);
            }}
            aria-label={copy("c015")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}

function useDialogFocusTrap() {
  useEffect(() => {
    const selector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const dialogs = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        ),
      );
    const focusLatest = () => {
      const dialog = dialogs().at(-1);
      if (dialog && !dialog.contains(document.activeElement))
        dialog.querySelector<HTMLElement>(selector)?.focus();
    };
    const observer = new MutationObserver(() => queueMicrotask(focusLatest));
    observer.observe(document.body, { childList: true, subtree: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = dialogs().at(-1);
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(selector),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", trap);
    };
  }, []);
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
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

function BoardSkeleton() {
  return (
    <section
      className="board-skeleton"
      aria-label={copy("c016")}
      aria-busy="true"
    >
      {[0, 1, 2].map((column) => (
        <div key={column}>
          <span />
          {[0, 1, 2].map((card) => (
            <span key={card} />
          ))}
        </div>
      ))}
    </section>
  );
}

function BoardView({
  board,
  search,
  selectedTaskId,
  onSelectTask,
  onAddTask,
  onMoveTask,
  onReorderTask,
  onConfigureColumn,
}: {
  board: Board;
  search: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onAddTask: (columnId: string) => void;
  onMoveTask: (taskId: string, columnId: string) => void;
  onReorderTask: (taskId: string, position: number) => void;
  onConfigureColumn: (columnId: string) => void;
}) {
  const [sort, setSort] = useState("manual");
  const filtered = useMemo(
    () =>
      board.tasks.filter(
        (task) =>
          !task.archived &&
          `${task.title} ${task.description} ${task.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [board.tasks, search],
  );
  return (
    <section
      className="board-scroll"
      aria-label={copy("c311", { name: board.name })}
    >
      <div className="board-view-toolbar">
        <label>
          {copy("c017")}

          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="manual">{copy("c018")}</option>
            <option value="date">{copy("c019")}</option>
            <option value="priority">{copy("c020")}</option>
            <option value="title">{copy("c021")}</option>
            {board.customFields.map((field) => (
              <option key={field.id} value={`field:${field.id}`}>
                {field.name}
              </option>
            ))}
          </select>
        </label>
        <small>{copy("c022")}</small>
      </div>
      <div className="board-grid">
        {[...board.columns]
          .sort((a, b) => a.position - b.position)
          .map((column) => {
            const tasks = filtered
              .filter((task) => task.columnId === column.id)
              .sort((a, b) => {
                if (sort === "title") return a.title.localeCompare(b.title);
                if (sort === "date")
                  return b.updatedAt.localeCompare(a.updatedAt);
                if (sort === "priority")
                  return (
                    { Haute: 0, Normale: 1, Basse: 2 }[
                      a.priority ?? "Normale"
                    ] -
                    { Haute: 0, Normale: 1, Basse: 2 }[b.priority ?? "Normale"]
                  );

                if (sort.startsWith("field:"))
                  return customValueText(
                    a.customValues[sort.slice(6)] ?? {
                      kind: "text",
                      value: "",
                    },
                  ).localeCompare(
                    customValueText(
                      b.customValues[sort.slice(6)] ?? {
                        kind: "text",
                        value: "",
                      },
                    ),
                  );
                return a.position - b.position;
              });
            const warning =
              column.wipPolicy.kind !== "none" &&
              tasks.length >= column.wipPolicy.limit;
            return (
              <section
                className="kanban-column"
                key={column.id}
                role="region"
                aria-label={column.name}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) =>
                  onMoveTask(
                    event.dataTransfer.getData("text/task-id"),
                    column.id,
                  )
                }
              >
                <header
                  className="column-header"
                  style={
                    { "--column-color": column.color } as React.CSSProperties
                  }
                >
                  <div>
                    <h2>{column.name}</h2>
                    <span className="count-badge">{tasks.length}</span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={copy("c302", { name: column.name })}
                    onClick={() => onConfigureColumn(column.id)}
                  >
                    <Icon name="more_horiz" />
                  </button>
                </header>
                {warning && (
                  <p className="wip-warning">
                    <Icon name="warning" />
                    {copy("c023")}{" "}
                    {column.wipPolicy.kind === "hard"
                      ? copy("c256")
                      : copy("c255")}
                  </p>
                )}
                <div className="card-list">
                  {tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      pinnedFields={board.customFields
                        .filter((field) => field.pinned)
                        .slice(0, 3)}
                      display={board.cardDisplay}
                      selected={selectedTaskId === task.id}
                      onSelect={() => onSelectTask(task.id)}
                      onReorder={(position) => onReorderTask(task.id, position)}
                      canReorder={sort === "manual"}
                      lastPosition={tasks.length - 1}
                    />
                  ))}
                  {!tasks.length && (
                    <div className="column-empty">
                      <Icon name="inbox" />
                      <span>{copy("c024")}</span>
                    </div>
                  )}
                </div>
                <button
                  className="add-task-button"
                  aria-label={copy("c303", { name: column.name })}
                  onClick={() => onAddTask(column.id)}
                >
                  <Icon name="add" />
                  {copy("c025")}
                </button>
              </section>
            );
          })}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  pinnedFields,
  display,
  selected,
  onSelect,
  onReorder,
  canReorder,
  lastPosition,
}: {
  task: Task;
  pinnedFields: Board["customFields"];
  display: Board["cardDisplay"];
  selected: boolean;
  onSelect: () => void;
  onReorder: (position: number) => void;
  canReorder: boolean;
  lastPosition: number;
}) {
  const running =
    typeof task.executionStatus === "object"
      ? task.executionStatus.running
      : null;
  return (
    <article
      className={selected ? "task-card selected" : "task-card"}
      draggable={!running}
      onDragStart={(event) => {
        if (running) event.preventDefault();
        else event.dataTransfer.setData("text/task-id", task.id);
      }}
    >
      <button
        className="task-card-main"
        onClick={onSelect}
        aria-label={task.title}
      >
        <span className="task-title">{task.title}</span>
        {task.description && (
          <span className="task-description">{task.description}</span>
        )}
        <span className="task-meta">
          {display.priority && task.priority && (
            <span>
              <Icon name="flag" />
              {task.priority}
            </span>
          )}
          {display.dueDate && task.dueDate && (
            <span>
              <Icon name="event" />
              {new Date(task.dueDate).toLocaleDateString("fr-FR")}
            </span>
          )}
        </span>
        {display.tags && !!task.tags.length && (
          <span className="tag-row">
            {task.tags.slice(0, 3).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </span>
        )}
        {pinnedFields.map(
          (field) =>
            task.customValues[field.id] && (
              <span className="pinned-field" key={field.id}>
                <small>{field.name}</small>
                {customValueText(task.customValues[field.id])}
              </span>
            ),
        )}
        {display.source && task.sourceName && (
          <span className="source-badge">
            <Icon name="input_circle" />
            {task.sourceName}
          </span>
        )}
        {task.absentFromSource && (
          <span className="status-badge status-pending">
            <Icon name="link_off" />
            {copy("c026")}
          </span>
        )}
        {display.automationStatus && task.executionStatus !== "idle" && (
          <span
            className={`status-badge status-${typeof task.executionStatus === "string" ? task.executionStatus : "running"}`}
          >
            <Icon
              name={
                task.executionStatus === "failed"
                  ? "error"
                  : running
                    ? "sync"
                    : "check_circle"
              }
            />

            {task.executionStatus === "failed"
              ? copy("c257")
              : running
                ? copy("c259", { step: running.step, total: running.total })
                : copy("c258")}
          </span>
        )}
      </button>
      {canReorder && (
        <span className="card-order-actions">
          <button
            className="icon-button"
            aria-label={copy("c314", { name: task.title })}
            disabled={!!running || task.position === 0}
            onClick={() => onReorder(task.position - 1)}
          >
            <Icon name="arrow_upward" />
          </button>
          <button
            className="icon-button"
            aria-label={copy("c315", { name: task.title })}
            disabled={!!running || task.position >= lastPosition}
            onClick={() => onReorder(task.position + 1)}
          >
            <Icon name="arrow_downward" />
          </button>
        </span>
      )}
    </article>
  );
}

function TaskPanel({
  task,
  board,
  onClose,
  onChange,
  onMove,
  onArchive,
  onOpenFailure,
  onCancel,
  onCustom,
}: {
  task: Task;
  board: Board;
  onClose: () => void;
  onChange: (task: Task) => void;
  onMove: (id: string) => void;
  onArchive: () => void;
  onOpenFailure: () => void;
  onCancel: () => void;
  onCustom: (fieldId: string, value: CustomFieldValue) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const locked = typeof task.executionStatus === "object";
  return (
    <aside
      className="detail-panel"
      aria-label={copy("c304", { name: task.title })}
    >
      <header>
        <div>
          <span className="eyebrow">{copy("c027")}</span>
          <h2>{copy("c028")}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={copy("c029")}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        <label>
          {copy("c021")}

          <input
            disabled={locked}
            value={task.title}
            onChange={(event) =>
              onChange({ ...task, title: event.target.value })
            }
          />
        </label>
        <label>
          {copy("c030")}

          <textarea
            disabled={locked}
            rows={5}
            value={task.description}
            placeholder={copy("c031")}
            onChange={(event) =>
              onChange({ ...task, description: event.target.value })
            }
          />
        </label>
        <div className="field-grid">
          <label>
            {copy("c020")}

            <select
              disabled={locked}
              value={task.priority ?? "Normale"}
              onChange={(event) =>
                onChange({
                  ...task,
                  priority: event.target.value as Task["priority"],
                })
              }
            >
              <option>{copy("c032")}</option>
              <option>{copy("c033")}</option>
              <option>{copy("c034")}</option>
            </select>
          </label>
          <label>
            {copy("c035")}

            <input
              disabled={locked}
              type="date"
              value={task.dueDate ?? ""}
              onChange={(event) =>
                onChange({ ...task, dueDate: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          {copy("c036")}

          <input
            disabled={locked}
            value={task.tags.join(", ")}
            placeholder={copy("c037")}
            onChange={(event) =>
              onChange({
                ...task,
                tags: event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label>
          {copy("c038")}

          <textarea
            disabled={locked}
            rows={4}
            value={task.notes}
            onChange={(event) =>
              onChange({ ...task, notes: event.target.value })
            }
          />
        </label>
        {board.customFields.map((field) => (
          <CustomFieldEditor
            key={field.id}
            task={task}
            field={field}
            disabled={locked}
            onChange={(value) => onCustom(field.id, value)}
          />
        ))}
        {task.history.length > 0 && (
          <section className="history-snippet">
            <h3>{copy("c039")}</h3>
            <p>
              <Icon name="swap_horiz" />{" "}
              {new Date(task.history.at(-1)!.occurredAt).toLocaleString(
                "fr-FR",
              )}
            </p>
          </section>
        )}
        {task.executionStatus === "failed" && (
          <button className="inline-error action-link" onClick={onOpenFailure}>
            <Icon name="error" />
            {copy("c040")}
          </button>
        )}
        {typeof task.executionStatus === "object" && (
          <button className="secondary-button" onClick={onCancel}>
            <Icon name="stop_circle" />
            {copy("c041")}
          </button>
        )}
      </div>
      <footer>
        <div className="move-control">
          <button
            className="secondary-button"
            disabled={locked}
            onClick={() => setMoveOpen(!moveOpen)}
          >
            <Icon name="drive_file_move" />
            {copy("c042")}
          </button>
          {moveOpen && (
            <div className="move-menu" role="menu">
              {board.columns
                .filter((column) => column.id !== task.columnId)
                .map((column) => {
                  const allowed =
                    !board.transitionsRestricted ||
                    board.allowedTransitions.some(
                      (transition) =>
                        transition.fromColumnId === task.columnId &&
                        transition.toColumnId === column.id,
                    );
                  return (
                    <button
                      role="menuitem"
                      aria-disabled={!allowed}
                      disabled={locked || !allowed}
                      title={
                        allowed
                          ? undefined
                          : copy("c300", { name: column.name })
                      }
                      key={column.id}
                      onClick={() => {
                        onMove(column.id);
                        setMoveOpen(false);
                      }}
                    >
                      {column.name}
                      {!allowed && ` — ${copy("c301")}`}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
        <button
          className="text-button danger"
          disabled={locked}
          onClick={onArchive}
        >
          <Icon name="archive" />
          {copy("c043")}
        </button>
      </footer>
    </aside>
  );
}

function customValueText(value: CustomFieldValue): string {
  if (value.kind === "secretRef") return copy("c260");
  if (value.kind === "boolean")
    return value.value ? copy("c317") : copy("c318");
  return String(value.value);
}

function CustomFieldEditor({
  task,
  field,
  disabled,
  onChange,
}: {
  task: Task;
  field: Board["customFields"][number];
  disabled?: boolean;
  onChange: (value: CustomFieldValue) => void;
}) {
  const current = task.customValues[field.id];
  if (field.kind === "boolean")
    return (
      <label className="check-row">
        <input
          disabled={disabled}
          type="checkbox"
          checked={current?.kind === "boolean" && current.value}
          onChange={(event) =>
            onChange({ kind: "boolean", value: event.target.checked })
          }
        />{" "}
        {field.name}
      </label>
    );

  if (field.kind === "number")
    return (
      <label>
        {field.name}
        <input
          disabled={disabled}
          type="number"
          value={current?.kind === "number" ? current.value : ""}
          onChange={(event) =>
            onChange({ kind: "number", value: Number(event.target.value) })
          }
        />
      </label>
    );

  if (field.kind === "date")
    return (
      <label>
        {field.name}
        <input
          disabled={disabled}
          type="date"
          value={current?.kind === "date" ? current.value : ""}
          onChange={(event) =>
            onChange({ kind: "date", value: event.target.value })
          }
        />
      </label>
    );

  if (field.kind === "secret") {
    const logicalName = `task-${task.id}-field-${field.id}`;
    return (
      <label>
        {field.name}
        <input
          disabled={disabled}
          type="password"
          value=""
          autoComplete="new-password"
          placeholder={
            current?.kind === "secretRef" ? copy("c261") : copy("c313")
          }
          onChange={(event) => {
            const secret = event.target.value;
            if (secret)
              void setSecret(logicalName, secret).then(() =>
                onChange({ kind: "secretRef", value: logicalName }),
              );
          }}
        />
      </label>
    );
  }
  if (typeof field.kind === "object")
    return (
      <label>
        {field.name}
        <select
          disabled={disabled}
          value={current?.kind === "list" ? current.value : ""}
          onChange={(event) =>
            onChange({ kind: "list", value: event.target.value })
          }
        >
          <option value="">{copy("c044")}</option>
          {field.kind.list.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );

  return (
    <label>
      {field.name}
      <input
        disabled={disabled}
        value={current?.kind === "text" ? current.value : ""}
        onChange={(event) =>
          onChange({ kind: "text", value: event.target.value })
        }
      />
    </label>
  );
}

function CreateDialog({
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

function ThemeSelect({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <label className="theme-select">
      <span className="sr-only">{copy("c007")}</span>
      <Icon name="contrast" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Theme)}
      >
        <option value="system">{copy("c047")}</option>
        <option value="light">{copy("c048")}</option>
        <option value="dark">{copy("c049")}</option>
      </select>
    </label>
  );
}

function LanguageSelect({
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

function CommandPalette({
  boards,
  onClose,
  onOpen,
}: {
  boards: Board[];
  onClose: () => void;
  onOpen: (page: Page, board?: Board, task?: Task) => void;
}) {
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<CommandAction[]>([]);
  const [sources, setSources] = useState<
    Array<{ source: SourceDefinition; board: Board }>
  >([]);
  useEffect(() => {
    void loadActions().then(setActions);
    void Promise.all(
      boards.map(async (board) =>
        (await loadSources(board.id)).map((source) => ({ source, board })),
      ),
    ).then((groups) => setSources(groups.flat()));
  }, [boards]);
  const results: Array<{
    board?: Board;
    task?: Task;
    label: string;
    kind: string;
    page: Page;
  }> = [
    ...boards
      .flatMap((board) => [
        { board, task: undefined, label: board.name, kind: copy("c266") },
        ...board.tasks
          .filter((task) => !task.archived)
          .map((task) => ({
            board,
            task,
            label: task.title,
            kind: copy("c267"),
          })),
      ])
      .map((result) => ({ ...result, page: "boards" as const })),
    ...actions.map((action) => ({
      label: action.name,
      kind: copy("c268"),
      page: "automations" as const,
    })),
    ...sources.map(({ source, board }) => ({
      board,
      label: source.name,
      kind: copy("c269"),
      page: "sources" as const,
    })),
  ]
    .filter((result) =>
      result.label.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 12);
  return (
    <div className="dialog-backdrop">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={copy("c053")}
      >
        <label>
          <Icon name="search" />
          <span className="sr-only">{copy("c054")}</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy("c055")}
          />

          <button className="key-button" onClick={onClose}>
            {copy("c056")}
          </button>
        </label>
        <div className="palette-results">
          {results.map((result) => (
            <button
              key={`${result.kind}-${result.label}`}
              onClick={() => onOpen(result.page, result.board, result.task)}
            >
              <span>
                <Icon
                  name={
                    result.kind === copy("c266")
                      ? "view_kanban"
                      : result.kind === copy("c267")
                        ? "task_alt"
                        : result.kind === copy("c268")
                          ? "terminal"
                          : "input_circle"
                  }
                />

                {result.label}
              </span>
              <small>
                {result.kind}
                {result.board ? ` · ${result.board.name}` : ""}
              </small>
            </button>
          ))}
          {!results.length && <p>{copy("c057")}</p>}
        </div>
      </div>
    </div>
  );
}

function SourcesPage({
  board,
  onImport,
  onBoard,
  onMessage,
}: {
  board: Board;
  onImport: (tasks: Task[]) => void;
  onBoard: (board: Board) => void;
  onMessage: (message: string) => void;
}) {
  const [raw, setRaw] = useState(() =>
    JSON.stringify([{ id: "42", title: copy("c312") }], null, 2),
  );
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [source, setSource] = useState<SourceDefinition>(() => ({
    id: "preview",
    boardId: "",
    name: copy("c270"),
    command: newCommandAction(copy("c270")),
    format: "json",
    mapping: { title: "$.title", externalKey: "$.id" },
    initialColumnId: "",
    columnMapping: {},
    allowedUpdateFields: ["title", "description"],
    customFieldMapping: {},
    allowedUpdateCustomFields: [],
    moveExistingTasks: false,
    acceptPartial: false,
    absenceThreshold: 3,
    outputLimitBytes: 10 * 1024 * 1024,
    encoding: "utf8",
    enabled: false,
  }));
  const [busy, setBusy] = useState(false);
  const [lastOutput, setLastOutput] = useState<{
    exitCode?: number;
    truncated: boolean;
    encodingErrors: boolean;
  } | null>(null);
  const [trigger, setTrigger] = useState<TriggerDefinition | null>(null);
  const [mappingTab, setMappingTab] = useState<"raw" | "mapping" | "preview">(
    "raw",
  );
  useEffect(() => {
    void loadSources(board.id).then((loaded) => {
      setSources(loaded);
      setSource(loaded[0] ?? newSource(board));
    });
  }, [board.id]);
  useEffect(() => {
    if (source.id === "preview") return;
    void loadTriggers(source.id).then((loaded) =>
      setTrigger(
        loaded[0] ?? {
          id: crypto.randomUUID(),
          sourceId: source.id,
          schedule: { kind: "interval", seconds: 3600 },
          enabled: false,
          catchUpLast: false,
        },
      ),
    );
  }, [source.id]);
  const parse = () => {
    void previewSourceInRepository(
      source.format,
      raw,
      source.mapping,
      source.textPattern,
    ).then(setPreview);
  };
  const apply = () => {
    const currentPreview = preview!;
    const column = board.columns[0];
    const tasks = currentPreview.records.map((record, position) => ({
      ...createTask(record.title, column.id, board.tasks.length + position),
      description: record.description,
      externalKey: record.externalKey,
      sourceId: source.id,
      sourceName: source.name,
    }));
    onImport(tasks);
    setPreview(null);
  };
  const saveSource = (enabled: boolean) => {
    const updated = {
      ...source,
      enabled,
      command: { ...source.command, enabled },
    };
    setSource(updated);
    setSources((current) =>
      current.some((item) => item.id === updated.id)
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [...current, updated],
    );
    void saveSourceInRepository(updated);
  };
  return (
    <section className="content-page">
      <header>
        <div>
          <span className="eyebrow">{copy("c058")}</span>
          <h2>{copy("c059")}</h2>
          <p>{copy("c060")}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => setSource(newSource(board))}
        >
          <Icon name="add" />
          {copy("c061")}
        </button>
      </header>
      <>
        <div className="source-toolbar">
          <label>
            {copy("c062")}

            <input
              value={source.name}
              onChange={(event) =>
                setSource({ ...source, name: event.target.value })
              }
            />
          </label>
          <label>
            {copy("c063")}

            <select
              value={source.format}
              onChange={(event) =>
                setSource({
                  ...source,
                  format: event.target.value as SourceDefinition["format"],
                })
              }
            >
              <option value="json">{copy("c064")}</option>
              <option value="jsonl">{copy("c065")}</option>
              <option value="text">{copy("c066")}</option>
            </select>
          </label>
          <label>
            {copy("c067")}

            <select
              value={source.encoding}
              onChange={(event) =>
                setSource({
                  ...source,
                  encoding: event.target.value as SourceDefinition["encoding"],
                })
              }
            >
              <option value="utf8">{copy("c068")}</option>
              <option value="windows1252">{copy("c069")}</option>
              <option value="system">{copy("c047")}</option>
              <option value="auto">{copy("c070")}</option>
            </select>
          </label>
          <label>
            {copy("c071")}

            <input
              value={source.command.script}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: { ...source.command, script: event.target.value },
                })
              }
            />
          </label>
          <button
            className="secondary-button"
            onClick={() => saveSource(false)}
          >
            {copy("c072")}
          </button>
          <button className="primary-button" onClick={() => saveSource(true)}>
            {copy("c073")}
          </button>
          {source.enabled && isDesktopRuntime() && (
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void inspectSourceNow(source.id)
                    .then((result) => {
                      setPreview(result.preview);
                      setLastOutput(result.output);
                    })
                    .catch((error: unknown) => {
                      const message = String(error);
                      if (!message.toLowerCase().includes("annul"))
                        onMessage(message);
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Icon name="play_arrow" />
                {copy("c074")}
              </button>
              <button
                className="text-button danger"
                disabled={!busy}
                onClick={() =>
                  void cancelSourceExecution(source.id).catch(
                    (error: unknown) => onMessage(String(error)),
                  )
                }
              >
                <Icon name="stop_circle" />
                {copy("c344")}
              </button>
            </>
          )}
        </div>
        <details className="trigger-editor">
          <summary>
            <Icon name="tune" />
            {copy("c075")}
          </summary>
          <label>
            {copy("c076")}

            <input
              value={source.command.runner}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: { ...source.command, runner: event.target.value },
                })
              }
            />
          </label>
          <label>
            {copy("c077")}

            <input
              value={source.command.workingDirectory ?? ""}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: {
                    ...source.command,
                    workingDirectory: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          <label>
            {copy("c078")}

            <input
              aria-label={copy("c078")}
              type="number"
              min="0"
              value={source.command.timeoutSeconds ?? ""}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: {
                    ...source.command,
                    timeoutSeconds: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  },
                })
              }
            />
            {!source.command.timeoutSeconds && <small>{copy("c343")}</small>}
          </label>
          <label>
            {copy("c079")}

            <input
              value={source.command.acceptedExitCodes.join(", ")}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: {
                    ...source.command,
                    acceptedExitCodes: event.target.value
                      .split(",")
                      .map(Number)
                      .filter(Number.isFinite),
                  },
                })
              }
            />
          </label>
          <label>
            {copy("c080")}

            <input
              value={source.command.secretNames.join(", ")}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: {
                    ...source.command,
                    secretNames: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={source.command.loadProfile}
              onChange={(event) =>
                setSource({
                  ...source,
                  command: {
                    ...source.command,
                    loadProfile: event.target.checked,
                  },
                })
              }
            />{" "}
            {copy("c081")}
          </label>
          {(["macOs", "windows"] as const).map((operatingSystem) => {
            const variant = source.command.variants.find(
              (item) => item.operatingSystem === operatingSystem,
            );
            return (
              <fieldset key={operatingSystem}>
                <legend>
                  {copy("c334")} ·{" "}
                  {operatingSystem === "macOs" ? "macOS" : "Windows"}
                </legend>
                <label>
                  {copy("c076")}
                  <input
                    value={variant?.runner ?? ""}
                    onChange={(event) =>
                      setSource({
                        ...source,
                        command: {
                          ...source.command,
                          variants: [
                            ...source.command.variants.filter(
                              (item) =>
                                item.operatingSystem !== operatingSystem,
                            ),
                            {
                              operatingSystem,
                              runner: event.target.value,
                              script: variant?.script ?? "",
                            },
                          ],
                        },
                      })
                    }
                  />
                </label>
                <label>
                  {copy("c071")}
                  <textarea
                    value={variant?.script ?? ""}
                    onChange={(event) =>
                      setSource({
                        ...source,
                        command: {
                          ...source.command,
                          variants: [
                            ...source.command.variants.filter(
                              (item) =>
                                item.operatingSystem !== operatingSystem,
                            ),
                            {
                              operatingSystem,
                              runner: variant?.runner ?? "",
                              script: event.target.value,
                            },
                          ],
                        },
                      })
                    }
                  />
                </label>
              </fieldset>
            );
          })}
        </details>
        {trigger && (
          <details className="trigger-editor">
            <summary>
              <Icon name="schedule" />
              {copy("c082")}
            </summary>
            <label>
              {copy("c083")}

              <select
                value={trigger.schedule?.kind ?? "interval"}
                onChange={(event) => {
                  const timezone =
                    Intl.DateTimeFormat().resolvedOptions().timeZone;
                  const kind = event.target.value;
                  const schedule =
                    kind === "daily"
                      ? {
                          kind: "daily" as const,
                          hour: 9,
                          minute: 0,
                          timezone,
                        }
                      : kind === "weekly"
                        ? {
                            kind: "weekly" as const,
                            weekdays: [1],
                            hour: 9,
                            minute: 0,
                            timezone,
                          }
                        : kind === "cron"
                          ? {
                              kind: "cron" as const,
                              expression: "0 0 9 * * *",
                              timezone,
                            }
                          : { kind: "interval" as const, seconds: 3600 };
                  setTrigger({ ...trigger, schedule });
                }}
              >
                <option value="interval">{copy("c084")}</option>
                <option value="daily">{copy("c085")}</option>
                <option value="weekly">{copy("c086")}</option>
                <option value="cron">{copy("c087")}</option>
              </select>
            </label>
            {trigger.schedule?.kind === "interval" && (
              <label>
                {copy("c088")}

                <input
                  aria-label={copy("c078")}
                  type="number"
                  min="1"
                  value={trigger.schedule.seconds}
                  onChange={(event) =>
                    setTrigger({
                      ...trigger,
                      schedule: {
                        kind: "interval",
                        seconds: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            )}
            {trigger.schedule?.kind === "cron" && (
              <>
                <label>
                  {copy("c089")}

                  <input
                    value={trigger.schedule.expression}
                    onChange={(event) =>
                      setTrigger({
                        ...trigger,
                        schedule: {
                          kind: "cron",
                          expression: event.target.value,
                          timezone: (
                            trigger.schedule as {
                              kind: "cron";
                              expression: string;
                              timezone: string;
                            }
                          ).timezone,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  {copy("c090")}

                  <input
                    value={trigger.schedule.timezone}
                    onChange={(event) =>
                      setTrigger({
                        ...trigger,
                        schedule: {
                          ...trigger.schedule!,
                          timezone: event.target.value,
                        } as TriggerDefinition["schedule"],
                      })
                    }
                  />
                </label>
              </>
            )}
            {(trigger.schedule?.kind === "daily" ||
              trigger.schedule?.kind === "weekly") && (
              <>
                <label>
                  {copy("c091")}

                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={trigger.schedule.hour}
                    onChange={(event) =>
                      setTrigger({
                        ...trigger,
                        schedule: {
                          ...trigger.schedule!,
                          hour: Number(event.target.value),
                        } as TriggerDefinition["schedule"],
                      })
                    }
                  />
                </label>
                <label>
                  {copy("c092")}

                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={trigger.schedule.minute}
                    onChange={(event) =>
                      setTrigger({
                        ...trigger,
                        schedule: {
                          ...trigger.schedule!,
                          minute: Number(event.target.value),
                        } as TriggerDefinition["schedule"],
                      })
                    }
                  />
                </label>
                <label>
                  {copy("c090")}

                  <input
                    value={trigger.schedule.timezone}
                    onChange={(event) =>
                      setTrigger({
                        ...trigger,
                        schedule: {
                          ...trigger.schedule!,
                          timezone: event.target.value,
                        } as TriggerDefinition["schedule"],
                      })
                    }
                  />
                </label>
              </>
            )}
            {trigger.schedule?.kind === "weekly" && (
              <fieldset>
                <legend>{copy("c093")}</legend>
                {[
                  [1, "Lun"],
                  [2, "Mar"],
                  [3, "Mer"],
                  [4, "Jeu"],
                  [5, "Ven"],
                  [6, "Sam"],
                  [7, "Dim"],
                ].map(([day, label]) => (
                  <label className="check-row" key={day}>
                    <input
                      type="checkbox"
                      checked={
                        trigger.schedule?.kind === "weekly" &&
                        trigger.schedule.weekdays.includes(Number(day))
                      }
                      onChange={(event) => {
                        const schedule = trigger.schedule as Extract<
                          NonNullable<TriggerDefinition["schedule"]>,
                          { kind: "weekly" }
                        >;
                        const weekdays = event.target.checked
                          ? [...new Set([...schedule.weekdays, Number(day)])]
                          : schedule.weekdays.filter(
                              (value) => value !== Number(day),
                            );
                        setTrigger({
                          ...trigger,
                          schedule: { ...schedule, weekdays },
                        });
                      }}
                    />{" "}
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="check-row">
              <input
                type="checkbox"
                checked={trigger.catchUpLast}
                onChange={(event) =>
                  setTrigger({
                    ...trigger,
                    catchUpLast: event.target.checked,
                  })
                }
              />{" "}
              {copy("c094")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={trigger.enabled}
                onChange={(event) =>
                  setTrigger({ ...trigger, enabled: event.target.checked })
                }
              />{" "}
              {copy("c095")}
            </label>
            <button
              className="secondary-button"
              onClick={() => void saveTriggerInRepository(trigger)}
            >
              {copy("c096")}
            </button>
          </details>
        )}
      </>
      <div
        className="mapping-mobile-tabs"
        role="tablist"
        aria-label={copy("c097")}
      >
        {(["raw", "mapping", "preview"] as const).map((item) => (
          <button
            role="tab"
            aria-selected={mappingTab === item}
            className={mappingTab === item ? "active" : ""}
            key={item}
            onClick={() => setMappingTab(item)}
          >
            {item === "raw"
              ? copy("c305")
              : item === "mapping"
                ? copy("c100")
                : copy("c114")}
          </button>
        ))}
      </div>
      <div className="mapping-grid">
        <section
          className={
            mappingTab === "raw" ? "editor-pane mobile-active" : "editor-pane"
          }
        >
          <div className="pane-title">
            <strong>{copy("c098")}</strong>
            <span>{source.format.toUpperCase()}</span>
          </div>
          <textarea
            aria-label={copy("c098")}
            spellCheck={false}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />

          {preview?.errors.map((error) => (
            <p className="inline-error" key={`${error.line}-${error.message}`}>
              <Icon name="error" />
              {copy("c099")}
              {error.line}: {error.message}
            </p>
          ))}
        </section>
        <section
          className={
            mappingTab === "mapping"
              ? "mapping-pane mobile-active"
              : "mapping-pane"
          }
        >
          <div className="pane-title">
            <strong>{copy("c100")}</strong>
            <span>{copy("c101")}</span>
          </div>
          <label>
            {copy("c021")}

            <input
              value={source.mapping.title}
              onChange={(event) =>
                setSource({
                  ...source,
                  mapping: { ...source.mapping, title: event.target.value },
                })
              }
            />
          </label>
          <label>
            {copy("c030")}

            <input
              value={source.mapping.description ?? ""}
              onChange={(event) =>
                setSource({
                  ...source,
                  mapping: {
                    ...source.mapping,
                    description: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          <label>
            {copy("c102")}

            <input
              value={source.mapping.externalKey ?? ""}
              onChange={(event) =>
                setSource({
                  ...source,
                  mapping: {
                    ...source.mapping,
                    externalKey: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          <label>
            {copy("c103")}

            <input
              value={source.mapping.column ?? ""}
              onChange={(event) =>
                setSource({
                  ...source,
                  mapping: {
                    ...source.mapping,
                    column: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          {board && (
            <>
              <label>
                {copy("c104")}

                <select
                  value={source.initialColumnId}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      initialColumnId: event.target.value,
                    })
                  }
                >
                  {board.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy("c105")}

                <textarea
                  defaultValue={JSON.stringify(source.columnMapping, null, 2)}
                  onBlur={(event) => {
                    try {
                      setSource({
                        ...source,
                        columnMapping: JSON.parse(event.target.value) as Record<
                          string,
                          string
                        >,
                      });
                    } catch {
                      setPreview({
                        records: [],
                        warnings: [],
                        errors: [
                          {
                            line: 0,
                            message: "Table de correspondance JSON invalide",
                          },
                        ],
                      });
                    }
                  }}
                />
              </label>
              {board.customFields
                .filter((field) => field.kind !== "secret")
                .map((field) => (
                  <div key={field.id}>
                    <label>
                      {copy("c359", { name: field.name })}
                      <input
                        value={source.customFieldMapping[field.id] ?? ""}
                        onChange={(event) => {
                          const customFieldMapping = {
                            ...source.customFieldMapping,
                          };
                          if (event.target.value)
                            customFieldMapping[field.id] = event.target.value;
                          else delete customFieldMapping[field.id];
                          setSource({ ...source, customFieldMapping });
                        }}
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={source.allowedUpdateCustomFields.includes(
                          field.id,
                        )}
                        onChange={(event) =>
                          setSource({
                            ...source,
                            allowedUpdateCustomFields: event.target.checked
                              ? [
                                  ...new Set([
                                    ...source.allowedUpdateCustomFields,
                                    field.id,
                                  ]),
                                ]
                              : source.allowedUpdateCustomFields.filter(
                                  (id) => id !== field.id,
                                ),
                          })
                        }
                      />{" "}
                      {copy("c360", { name: field.name })}
                    </label>
                  </div>
                ))}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={source.allowedUpdateFields.includes("title")}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      allowedUpdateFields: event.target.checked
                        ? [
                            ...new Set([
                              ...source.allowedUpdateFields,
                              "title" as const,
                            ]),
                          ]
                        : source.allowedUpdateFields.filter(
                            (field) => field !== "title",
                          ),
                    })
                  }
                />{" "}
                {copy("c106")}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={source.allowedUpdateFields.includes("description")}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      allowedUpdateFields: event.target.checked
                        ? [
                            ...new Set([
                              ...source.allowedUpdateFields,
                              "description" as const,
                            ]),
                          ]
                        : source.allowedUpdateFields.filter(
                            (field) => field !== "description",
                          ),
                    })
                  }
                />{" "}
                {copy("c107")}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={source.moveExistingTasks}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      moveExistingTasks: event.target.checked,
                    })
                  }
                />{" "}
                {copy("c108")}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={source.acceptPartial}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      acceptPartial: event.target.checked,
                    })
                  }
                />{" "}
                {copy("c109")}
              </label>
              <label>
                {copy("c110")}

                <input
                  type="number"
                  min="1"
                  value={source.absenceThreshold}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      absenceThreshold: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                {copy("c111")}

                <input
                  type="number"
                  min="1"
                  value={Math.round(source.outputLimitBytes / 1024 / 1024)}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      outputLimitBytes:
                        Number(event.target.value) * 1024 * 1024,
                    })
                  }
                />
              </label>
            </>
          )}
          {source.format === "text" && (
            <label>
              {copy("c112")}

              <input
                value={source.textPattern ?? ""}
                onChange={(event) =>
                  setSource({ ...source, textPattern: event.target.value })
                }
              />
            </label>
          )}
          <button className="secondary-button" onClick={parse}>
            <Icon name="preview" />
            {copy("c113")}
          </button>
        </section>
        <section
          className={
            mappingTab === "preview"
              ? "preview-pane mobile-active"
              : "preview-pane"
          }
        >
          <div className="pane-title">
            <strong>{copy("c114")}</strong>
            <span>
              {preview?.records.length ?? 0}
              {copy("c115")}
            </span>
          </div>
          {lastOutput &&
            (lastOutput.exitCode !== 0 || lastOutput.truncated) && (
              <p className="inline-error">
                <Icon name="warning" />
                {copy("c116")}
                {lastOutput.exitCode ?? "inconnu"}
                {lastOutput.truncated && ` · ${copy("c272")}`}
                {copy("c117")}
              </p>
            )}
          {preview?.warnings.map((warning) => (
            <p className="wip-warning" key={warning}>
              <Icon name="warning" />
              {warning}
            </p>
          ))}
          {preview?.records.map((record, index) => (
            <div
              className="preview-task"
              key={`${record.externalKey}-${index}`}
            >
              <Icon name="task_alt" />
              <span>
                {record.title}
                <small>{record.externalKey ?? copy("c273")}</small>
              </span>
            </div>
          ))}
          {!preview && (
            <div className="pane-empty">
              <Icon name="visibility" />
              <p>{copy("c118")}</p>
            </div>
          )}
          {preview && !isDesktopRuntime() && (
            <button className="primary-button" onClick={apply}>
              {copy("c119")} {preview.records.length} {copy("c120")}
            </button>
          )}
          {preview && isDesktopRuntime() && source.id !== "preview" && (
            <button
              className="primary-button"
              onClick={() =>
                void applySourceResult(source.id, preview).then(onBoard)
              }
            >
              {copy("c121")}
            </button>
          )}
        </section>
      </div>
    </section>
  );
}

function AutomationsPage({
  board,
  onMessage,
}: {
  board: Board;
  onMessage: (message: string) => void;
}) {
  const [tab, setTab] = useState("Commande");
  const [actions, setActions] = useState<CommandAction[]>([]);
  const [action, setAction] = useState<CommandAction>(() =>
    newCommandAction(copy("c274")),
  );
  const [drafts, setDrafts] = useState<AutomationDraft[]>([]);
  const [fromColumnId, setFromColumnId] = useState("");
  const [toColumnId, setToColumnId] = useState("");
  const [preview, setPreview] = useState<CommandPreview[]>([]);
  const [confirmTest, setConfirmTest] = useState(false);
  const [automationNotifications, setAutomationNotifications] = useState<
    NonNullable<TransitionAutomation["notifications"]>
  >({});
  const [condition, setCondition] = useState<ActionCondition | undefined>();
  const [draftSteps, setDraftSteps] = useState<ActionStep[]>([]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  useEffect(() => {
    void loadActions().then((loaded) => {
      setActions(loaded);
      if (loaded[0]) setAction(loaded[0]);
    });
  }, []);
  useEffect(() => {
    setFromColumnId(board.columns[0]?.id ?? "");
    setToColumnId(board.columns[1]?.id ?? "");
    void loadAutomationDrafts(board.id).then((loaded) => {
      setDrafts(loaded);
      setAutomationNotifications(loaded[0]?.draft.notifications ?? {});
      const loadedSteps = loaded[0]?.draft.steps ?? [];
      setDraftSteps(loadedSteps);
      setSelectedStepIndex(0);
      setCondition(loadedSteps[0]?.condition);
    });
  }, [board.id]);
  const updateCondition = (next: ActionCondition | undefined) => {
    setCondition(next);
    setDraftSteps((current) =>
      current.map((step, index) =>
        index === selectedStepIndex ? { ...step, condition: next } : step,
      ),
    );
  };
  const selectStep = (index: number) => {
    const step = draftSteps[index];
    setSelectedStepIndex(index);
    setCondition(step.condition);
    const selectedAction = actions.find((item) => item.id === step.actionId);
    if (selectedAction) setAction(selectedAction);
  };
  const saveAction = async () => {
    await saveActionInRepository(action);
    setActions((current) =>
      current.some((item) => item.id === action.id)
        ? current.map((item) => (item.id === action.id ? action : item))
        : [...current, action],
    );
    onMessage(copy("c275"));
  };
  const buildDraft = (): AutomationDraft | null => {
    if (!fromColumnId || !toColumnId) return null;
    const current = drafts[0];
    const automation: AutomationDraft["draft"] = {
      id: current?.automationId ?? crypto.randomUUID(),
      boardId: board.id,
      name: `Transition ${board.columns.find((column) => column.id === fromColumnId)?.name} → ${board.columns.find((column) => column.id === toColumnId)?.name}`,
      fromColumnId,
      toColumnId,
      origins: ["user", "source", "plugin", "system"],
      steps: draftSteps.length
        ? draftSteps
        : [{ actionId: action.id, stopOnFailure: true, condition }],
      requireConfirmation: action.destructive,
      enabled: false,
      notifications: automationNotifications,
    };
    return {
      automationId: automation.id,
      boardId: board.id,
      draft: automation,
      active: current?.active,
      revision: (current?.revision ?? 0) + 1,
      lastTestSucceeded: false,
    };
  };
  const saveDraft = async () => {
    await saveAction();
    const draft = buildDraft();
    if (!draft) return null;
    await saveAutomationDraftInRepository(draft);
    setDrafts([draft]);
    return draft;
  };
  const showPreview = async () => {
    const draft = await saveDraft();
    if (!draft) return;
    setPreview(await previewAutomationDraft(draft.automationId));
    setTab("Test");
  };
  const executeTest = async () => {
    const draft = drafts[0] ?? (await saveDraft());
    const task = board.tasks.find((candidate) => !candidate.archived);
    if (!draft || !task) {
      onMessage(copy("c276"));
      return;
    }
    if (isDesktopRuntime()) {
      const result = await testAutomationDraft(draft.automationId, task.id);
      onMessage(copy("c277", { status: result.status }));
      setDrafts(await loadAutomationDrafts(board.id));
    } else onMessage(copy("c278"));
    setConfirmTest(false);
  };
  const activate = async () => {
    const draft = drafts[0];
    if (!draft) return;
    if (isDesktopRuntime()) await activateAutomationDraft(draft.automationId);
    onMessage(copy("c279"));
  };
  return (
    <section className="content-page">
      <header>
        <div>
          <span className="eyebrow">{copy("c122")}</span>
          <h2>{copy("c123")}</h2>
          <p>{copy("c124")}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => setAction(newCommandAction())}
        >
          <Icon name="add" />
          {copy("c125")}
        </button>
      </header>
      <div className="automation-layout">
        <aside className="action-library" aria-label={copy("c126")}>
          {actions.map((item) => (
            <button
              className={item.id === action.id ? "active" : ""}
              key={item.id}
              onClick={() => setAction(item)}
            >
              <Icon name="terminal" />
              <span>
                {item.name}
                <small>{item.runner}</small>
              </span>
            </button>
          ))}
        </aside>
        <div className="automation-card">
          <div className="automation-heading">
            <div className="automation-icon">
              <Icon name="terminal" />
            </div>
            <div>
              <input
                aria-label={copy("c127")}
                value={action.name}
                onChange={(event) =>
                  setAction({ ...action, name: event.target.value })
                }
              />

              <p>
                {action.runner} ·{" "}
                {drafts[0]?.active ? "active + brouillon" : "brouillon"}
              </p>
              <fieldset>
                <legend>{copy("c128")}</legend>
                <label>
                  {copy("c083")}

                  <select
                    value={condition?.kind ?? "none"}
                    onChange={(event) => {
                      const kind = event.target.value;
                      updateCondition(
                        kind === "fieldEquals"
                          ? { kind, field: "title", value: "" }
                          : kind === "fieldContains"
                            ? { kind, field: "title", value: "" }
                            : kind === "origin"
                              ? { kind, origin: "user" }
                              : kind === "operatingSystem"
                                ? { kind, name: "macOs" }
                                : undefined,
                      );
                    }}
                  >
                    <option value="none">{copy("c129")}</option>
                    <option value="fieldEquals">{copy("c130")}</option>
                    <option value="fieldContains">{copy("c131")}</option>
                    <option value="origin">{copy("c132")}</option>
                    <option value="operatingSystem">{copy("c047")}</option>
                  </select>
                </label>
                {(condition?.kind === "fieldEquals" ||
                  condition?.kind === "fieldContains") && (
                  <>
                    <label>
                      {copy("c133")}

                      <select
                        value={condition.field}
                        onChange={(event) =>
                          updateCondition({
                            ...condition,
                            field: event.target.value,
                          })
                        }
                      >
                        <option value="title">{copy("c021")}</option>
                        <option value="description">{copy("c030")}</option>
                        <option value="priority">{copy("c020")}</option>
                        <option value="tags">{copy("c036")}</option>
                        {board?.customFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {copy("c134")}

                      <input
                        value={condition.value}
                        onChange={(event) =>
                          updateCondition({
                            ...condition,
                            value: event.target.value,
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {condition?.kind === "origin" && (
                  <label>
                    {copy("c132")}

                    <select
                      value={condition.origin}
                      onChange={(event) =>
                        updateCondition({
                          ...condition,
                          origin: event.target.value as
                            "user" | "source" | "plugin" | "system",
                        })
                      }
                    >
                      <option value="user">{copy("c135")}</option>
                      <option value="source">{copy("c062")}</option>
                      <option value="plugin">{copy("c136")}</option>
                      <option value="system">{copy("c047")}</option>
                    </select>
                  </label>
                )}
                {condition?.kind === "operatingSystem" && (
                  <label>
                    {copy("c047")}

                    <select
                      value={condition.name}
                      onChange={(event) =>
                        updateCondition({
                          ...condition,
                          name: event.target.value,
                        })
                      }
                    >
                      <option value="macOs">{copy("c137")}</option>
                      <option value="windows">{copy("c138")}</option>
                    </select>
                  </label>
                )}
              </fieldset>
            </div>
            <span className="draft-badge">
              {copy("c139")}
              {drafts[0]?.revision ?? 1}
            </span>
          </div>
          <div className="tabs" role="tablist">
            {["Commande", "Contexte", "Conditions", "Test"].map((item) => (
              <button
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? "active" : ""}
                key={item}
                onClick={() => setTab(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {tab === "Commande" ? (
            <div className="code-editor">
              <div className="code-meta">
                <label>
                  {copy("c076")}

                  <input
                    value={action.runner}
                    onChange={(event) =>
                      setAction({ ...action, runner: event.target.value })
                    }
                  />
                </label>
                <button
                  onClick={() =>
                    setAction({
                      ...action,
                      script: `${action.script}$WORKONIT_TITLE`,
                    })
                  }
                >
                  <Icon name="data_object" />
                  {copy("c140")}
                </button>
              </div>
              <div>
                <span className="line-number">1</span>
                <textarea
                  aria-label={copy("c141")}
                  value={action.script}
                  onChange={(event) =>
                    setAction({ ...action, script: event.target.value })
                  }
                />
              </div>
            </div>
          ) : tab === "Contexte" ? (
            <div className="automation-form">
              <label>
                {copy("c077")}

                <input
                  value={action.workingDirectory ?? ""}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      workingDirectory: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <label>
                {copy("c078")}

                <input
                  aria-label={copy("c078")}
                  type="number"
                  value={action.timeoutSeconds ?? ""}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      timeoutSeconds: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
                {!action.timeoutSeconds && <small>{copy("c343")}</small>}
              </label>
              <label>
                {copy("c079")}

                <input
                  value={action.acceptedExitCodes.join(", ")}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      acceptedExitCodes: event.target.value
                        .split(",")
                        .map(Number)
                        .filter(Number.isFinite),
                    })
                  }
                />
              </label>
              <label>
                {copy("c142")}

                <input
                  type="number"
                  min="1"
                  value={Math.ceil(action.outputLimitBytes / 1024)}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      outputLimitBytes: Number(event.target.value) * 1024,
                    })
                  }
                />
              </label>
              <label>
                {copy("c143")}

                <input
                  value={action.secretNames.join(", ")}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      secretNames: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                {copy("c144")}

                <select
                  value={action.stdoutValidation?.kind ?? "none"}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      stdoutValidation:
                        event.target.value === "none"
                          ? undefined
                          : {
                              kind: event.target.value as "regex" | "jsonPath",
                              expression:
                                action.stdoutValidation?.expression ?? "",
                            },
                    })
                  }
                >
                  <option value="none">{copy("c145")}</option>
                  <option value="regex">{copy("c146")}</option>
                  <option value="jsonPath">{copy("c147")}</option>
                </select>
              </label>
              {action.stdoutValidation && (
                <label>
                  {copy("c148")}

                  <input
                    value={action.stdoutValidation.expression}
                    onChange={(event) =>
                      setAction({
                        ...action,
                        stdoutValidation: {
                          ...action.stdoutValidation!,
                          expression: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              )}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={action.directExecution}
                  onChange={(event) =>
                    setAction({
                      ...action,
                      directExecution: event.target.checked,
                    })
                  }
                />{" "}
                {copy("c149")}
              </label>
              {action.directExecution && (
                <label>
                  {copy("c150")}

                  <textarea
                    value={action.arguments.join("\n")}
                    onChange={(event) =>
                      setAction({
                        ...action,
                        arguments: event.target.value.split("\n"),
                      })
                    }
                  />
                </label>
              )}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={action.loadProfile}
                  onChange={(event) =>
                    setAction({ ...action, loadProfile: event.target.checked })
                  }
                />{" "}
                {copy("c081")}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={action.destructive}
                  onChange={(event) =>
                    setAction({ ...action, destructive: event.target.checked })
                  }
                />{" "}
                {copy("c151")}
              </label>
              <p className="security-note">
                <Icon name="shield" />
                {copy("c152")}
              </p>
              {(["macOs", "windows"] as const).map((operatingSystem) => {
                const variant = action.variants.find(
                  (item) => item.operatingSystem === operatingSystem,
                );
                return (
                  <fieldset key={operatingSystem}>
                    <legend>
                      {copy("c153")}{" "}
                      {operatingSystem === "macOs" ? "macOS" : "Windows"}
                    </legend>
                    <label>
                      {copy("c076")}

                      <input
                        value={variant?.runner ?? ""}
                        onChange={(event) =>
                          setAction({
                            ...action,
                            variants: [
                              ...action.variants.filter(
                                (item) =>
                                  item.operatingSystem !== operatingSystem,
                              ),
                              {
                                operatingSystem,
                                runner: event.target.value,
                                script: variant?.script ?? "",
                              },
                            ],
                          })
                        }
                      />
                    </label>
                    <label>
                      {copy("c071")}

                      <textarea
                        value={variant?.script ?? ""}
                        onChange={(event) =>
                          setAction({
                            ...action,
                            variants: [
                              ...action.variants.filter(
                                (item) =>
                                  item.operatingSystem !== operatingSystem,
                              ),
                              {
                                operatingSystem,
                                runner: variant?.runner ?? "",
                                script: event.target.value,
                              },
                            ],
                          })
                        }
                      />
                    </label>
                  </fieldset>
                );
              })}
            </div>
          ) : tab === "Conditions" ? (
            <div className="automation-form">
              <label>
                {copy("c154")}

                <select
                  value={fromColumnId}
                  onChange={(event) => setFromColumnId(event.target.value)}
                >
                  {board.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy("c155")}

                <select
                  value={toColumnId}
                  onChange={(event) => setToColumnId(event.target.value)}
                >
                  {board.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
              <p>{copy("c156")}</p>
              <fieldset>
                <legend>{copy("c157")}</legend>
                {(
                  [
                    ["success", copy("c294")],
                    ["failure", copy("c291")],
                    ["confirmation", copy("c306")],
                    ["sourceBlocked", copy("c307")],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      value={
                        automationNotifications[key] === undefined
                          ? "inherit"
                          : String(automationNotifications[key])
                      }
                      onChange={(event) =>
                        setAutomationNotifications((current) => ({
                          ...current,
                          [key]:
                            event.target.value === "inherit"
                              ? undefined
                              : event.target.value === "true",
                        }))
                      }
                    >
                      <option value="inherit">{copy("c158")}</option>
                      <option value="true">{copy("c159")}</option>
                      <option value="false">{copy("c160")}</option>
                    </select>
                  </label>
                ))}
              </fieldset>
              <fieldset className="action-chain-editor">
                <legend>{copy("c325")}</legend>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    const next = [
                      ...draftSteps,
                      {
                        actionId: action.id,
                        stopOnFailure: true,
                        condition,
                      },
                    ];
                    setDraftSteps(next);
                    setSelectedStepIndex(next.length - 1);
                  }}
                >
                  <Icon name="add" />
                  {copy("c326")}
                </button>
                {!draftSteps.length && <p>{copy("c327")}</p>}
                {draftSteps.map((step, index) => {
                  const stepAction = actions.find(
                    (item) => item.id === step.actionId,
                  );
                  const name = stepAction?.name ?? step.actionId;
                  return (
                    <article
                      className={
                        index === selectedStepIndex
                          ? "action-chain-step active"
                          : "action-chain-step"
                      }
                      key={`${step.actionId}-${index}`}
                    >
                      <button
                        className="text-button"
                        type="button"
                        aria-label={copy("c329", { name })}
                        onClick={() => selectStep(index)}
                      >
                        {copy("c333", { position: index + 1, name })}
                      </button>
                      <label>
                        <input
                          type="checkbox"
                          checked={step.stopOnFailure}
                          onChange={(event) =>
                            setDraftSteps((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      stopOnFailure: event.target.checked,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        {copy("c328")}
                      </label>
                      <span className="chain-step-actions">
                        <button
                          className="icon-button"
                          type="button"
                          disabled={index === 0}
                          aria-label={copy("c330", { name })}
                          onClick={() =>
                            setDraftSteps((current) => {
                              const next = [...current];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              setSelectedStepIndex(index - 1);
                              return next;
                            })
                          }
                        >
                          <Icon name="arrow_upward" />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          disabled={index === draftSteps.length - 1}
                          aria-label={copy("c331", { name })}
                          onClick={() =>
                            setDraftSteps((current) => {
                              const next = [...current];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index],
                              ];
                              setSelectedStepIndex(index + 1);
                              return next;
                            })
                          }
                        >
                          <Icon name="arrow_downward" />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={copy("c332", { name })}
                          onClick={() => {
                            setDraftSteps((current) =>
                              current.filter(
                                (_item, itemIndex) => itemIndex !== index,
                              ),
                            );
                            setSelectedStepIndex(0);
                          }}
                        >
                          <Icon name="delete" />
                        </button>
                      </span>
                    </article>
                  );
                })}
              </fieldset>
            </div>
          ) : (
            <div className="test-panel">
              <button
                className="secondary-button"
                onClick={() => void showPreview()}
              >
                <Icon name="preview" />
                {copy("c161")}
              </button>
              {preview.map((item) => (
                <pre key={item.actionId}>
                  <strong>{item.actionName}</strong>
                  {`\nRunner: ${item.runner}\n${copy("c077")}: ${item.workingDirectory ?? copy("c280")}\n${copy("c309")}: ${item.environmentVariables.join(", ")}\n${copy("c310")}: ${item.secretNames.join(", ") || copy("c281")}\n\n${item.script}`}
                </pre>
              ))}
              <button
                className="secondary-button"
                onClick={() => setConfirmTest(true)}
              >
                <Icon name="science" />
                {copy("c162")}
              </button>
            </div>
          )}
          <footer>
            <button
              className="secondary-button"
              onClick={() => void showPreview()}
            >
              <Icon name="preview" />
              {copy("c113")}
            </button>
            <button
              className="secondary-button"
              onClick={() => void saveDraft()}
            >
              <Icon name="save" />
              {copy("c072")}
            </button>
            <button
              className="primary-button"
              disabled={!drafts[0]?.lastTestSucceeded && isDesktopRuntime()}
              onClick={() => void activate()}
            >
              <Icon name="publish" />
              {copy("c073")}
            </button>
          </footer>
        </div>
      </div>
      {confirmTest && (
        <div className="dialog-backdrop nested">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={copy("c163")}
          >
            <h3>{copy("c164")}</h3>
            <p>{copy("c165")}</p>
            <footer>
              <button
                className="text-button"
                onClick={() => setConfirmTest(false)}
              >
                {copy("c012")}
              </button>
              <button
                className="primary-button"
                onClick={() => void executeTest()}
              >
                {copy("c166")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

function HistoryPage({
  boards,
  onBoards,
  onMessage,
}: {
  boards: Board[];
  onBoards: (boards: Board[]) => void;
  onMessage: (message: string) => void;
}) {
  const records = boards
    .flatMap((board) =>
      board.tasks.flatMap((task) =>
        task.history.map((history) => ({ board, task, history })),
      ),
    )
    .sort((a, b) => b.history.occurredAt.localeCompare(a.history.occurredAt));
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [schedulerJournal, setSchedulerJournal] = useState<
    SchedulerJournalEntry[]
  >([]);
  const [selected, setSelected] = useState<ExecutionRecord | null>(null);
  useEffect(() => {
    void loadExecutions().then(setExecutions);
    void loadSchedulerJournal().then(setSchedulerJournal);
  }, []);
  const recover = async (restartAll: boolean) => {
    const execution = selected!;
    const board = boards.find((candidate) =>
      candidate.tasks.some((task) => task.id === execution.taskId),
    )!;
    try {
      await resumeExecutionInRepository(board.id, execution.id, restartAll);
      setExecutions(await loadExecutions());
      onBoards(await loadBoards());
      setSelected(null);
      onMessage(copy("c322"));
    } catch (error) {
      onMessage(String(error));
    }
  };
  const abandon = async () => {
    const execution = selected!;
    const board = boards.find((candidate) =>
      candidate.tasks.some((task) => task.id === execution.taskId),
    )!;
    try {
      await abandonExecutionInRepository(board.id, execution.id);
      setExecutions(await loadExecutions());
      onBoards(await loadBoards());
      setSelected(null);
      onMessage(copy("c323"));
    } catch (error) {
      onMessage(String(error));
    }
  };
  return (
    <section className="content-page">
      <header>
        <div>
          <span className="eyebrow">{copy("c167")}</span>
          <h2>{copy("c168")}</h2>
          <p>{copy("c169")}</p>
        </div>
      </header>
      <div className="history-list">
        {executions.map((execution) => (
          <button
            className="execution-row"
            key={execution.id}
            onClick={() => setSelected(execution)}
          >
            <span
              className={`timeline-icon status-${typeof execution.status === "string" ? execution.status : "running"}`}
            >
              <Icon
                name={execution.status === "failed" ? "error" : "terminal"}
              />
            </span>
            <span>
              <strong>
                {boards
                  .flatMap((board) => board.tasks)
                  .find((task) => task.id === execution.taskId)?.title ??
                  copy("c308")}
              </strong>
              <small>
                {execution.steps.length}
                {copy("c170")}{" "}
                {typeof execution.status === "string"
                  ? execution.status
                  : "en cours"}
              </small>
            </span>
            <time>{new Date(execution.startedAt).toLocaleString("fr-FR")}</time>
          </button>
        ))}
        {records.map(({ board, task, history }) => (
          <article key={history.occurredAt + task.id}>
            <div className="timeline-icon">
              <Icon name="swap_horiz" />
            </div>
            <div>
              <h3>{task.title}</h3>
              <p>
                {copy("c171")}{" "}
                {
                  board.columns.find(
                    (column) => column.id === history.toColumnId,
                  )?.name
                }{" "}
                · {board.name}
              </p>
            </div>
            <time>{new Date(history.occurredAt).toLocaleString("fr-FR")}</time>
          </article>
        ))}
        {schedulerJournal.map((entry) => (
          <article key={entry.id}>
            <div className="timeline-icon">
              <Icon name="schedule" />
            </div>
            <div>
              <h3>{copy("c356")}</h3>
              <p>
                {entry.kind === "missed" ? copy("c357") : copy("c358")} ·{" "}
                {entry.sourceId}
              </p>
            </div>
            <time>{new Date(entry.occurredAt).toLocaleString("fr-FR")}</time>
          </article>
        ))}
        {!records.length && !executions.length && !schedulerJournal.length && (
          <div className="history-empty">
            <Icon name="history" />
            <h3>{copy("c172")}</h3>
            <p>{copy("c173")}</p>
          </div>
        )}
      </div>
      {selected && (
        <aside className="execution-detail" aria-label={copy("c174")}>
          <header>
            <h3>{copy("c175")}</h3>
            <button
              className="icon-button"
              aria-label={copy("c176")}
              onClick={() => setSelected(null)}
            >
              <Icon name="close" />
            </button>
          </header>
          {selected.steps.map((step) => (
            <section key={`${step.actionId}-${step.startedAt}`}>
              <h4>
                {step.actionName} · {step.status}
              </h4>
              {step.stdout && (
                <pre aria-label={copy("c177")}>{step.stdout}</pre>
              )}
              {step.stderr && (
                <pre className="error-output" aria-label={copy("c178")}>
                  {step.stderr}
                </pre>
              )}
            </section>
          ))}
          {(selected.status === "failed" ||
            selected.status === "interrupted") && (
            <footer aria-label={copy("c324")}>
              <button
                className="secondary-button"
                onClick={() => void recover(false)}
              >
                {copy("c319")}
              </button>
              <button
                className="secondary-button"
                onClick={() => void recover(true)}
              >
                {copy("c320")}
              </button>
              {selected.status === "interrupted" && (
                <button
                  className="text-button danger"
                  onClick={() => void abandon()}
                >
                  {copy("c321")}
                </button>
              )}
            </footer>
          )}
        </aside>
      )}
    </section>
  );
}

function ColumnPanel({
  board,
  columnId,
  onBoard,
  onClose,
  onMessage,
}: {
  board: Board;
  columnId: string;
  onBoard: (board: Board) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const column = board.columns.find((candidate) => candidate.id === columnId)!;
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color);
  const [wipKind, setWipKind] = useState(column.wipPolicy.kind);
  const [limit, setLimit] = useState(
    column.wipPolicy.kind === "none" ? 5 : column.wipPolicy.limit,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [automationDrafts, setAutomationDrafts] = useState<AutomationDraft[]>(
    [],
  );
  const [destinationId, setDestinationId] = useState(
    board.columns.find((candidate) => candidate.id !== columnId)?.id ?? "",
  );
  const affectedTasks = board.tasks.filter(
    (task) => task.columnId === columnId && !task.archived,
  );
  const affectedAutomations = automationDrafts.filter((automation) => {
    const definitions = [automation.draft, automation.active].filter(
      (definition) => definition !== undefined,
    );
    return definitions.some(
      (definition) =>
        definition.fromColumnId === columnId ||
        definition.toColumnId === columnId,
    );
  });
  useEffect(() => {
    void loadAutomationDrafts(board.id).then(setAutomationDrafts);
  }, [board.id]);
  const saveColumn = () => {
    const wipPolicy: WipPolicy =
      wipKind === "none" ? { kind: "none" } : { kind: wipKind, limit };
    void configureColumnInRepository(
      board,
      columnId,
      name,
      color,
      wipPolicy,
    ).then((updated) => {
      onBoard(updated);
      onMessage(copy("c282"));
    });
  };
  return (
    <aside
      className="detail-panel"
      aria-label={copy("c316", { name: column.name })}
    >
      <header>
        <div>
          <span className="eyebrow">{copy("c179")}</span>
          <h2>{copy("c180")}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={copy("c181")}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body">
        <label>
          {copy("c182")}

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {copy("c183")}

          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label>
          {copy("c184")}

          <select
            value={wipKind}
            onChange={(event) =>
              setWipKind(event.target.value as WipPolicy["kind"])
            }
          >
            <option value="none">{copy("c145")}</option>
            <option value="warning">{copy("c185")}</option>
            <option value="hard">{copy("c186")}</option>
          </select>
        </label>
        {wipKind !== "none" && (
          <label>
            {copy("c187")}

            <input
              type="number"
              min="1"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
        )}
        <button className="primary-button" onClick={saveColumn}>
          {copy("c188")}
        </button>
        <button
          className="text-button danger"
          disabled={board.columns.length < 2}
          onClick={() => setDeleteOpen(true)}
        >
          <Icon name="delete" />
          {copy("c189")}
        </button>
        {deleteOpen && (
          <section
            className="deletion-impact"
            role="alertdialog"
            aria-label={copy("c190")}
          >
            <h3>{copy("c191")}</h3>
            <p>
              {affectedTasks.length}
              {copy("c192")}
            </p>
            <ul>
              {affectedTasks.map((task) => (
                <li key={task.id}>{task.title}</li>
              ))}
            </ul>
            <p>{copy("c349", { count: affectedAutomations.length })}</p>
            <ul>
              {affectedAutomations.map((automation) => (
                <li key={automation.automationId}>{automation.draft.name}</li>
              ))}
            </ul>
            <label>
              {copy("c193")}

              <select
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                {board.columns
                  .filter((candidate) => candidate.id !== columnId)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="text-button"
                onClick={() => setDeleteOpen(false)}
              >
                {copy("c012")}
              </button>
              <button
                className="primary-button danger-fill"
                onClick={() =>
                  void deleteColumnInRepository(
                    board,
                    columnId,
                    destinationId,
                  ).then((updated) => {
                    onBoard(updated);
                    onClose();
                    onMessage(copy("c283"));
                  })
                }
              >
                {copy("c194")}
              </button>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function BoardSettingsDialog({
  board,
  onBoard,
  onClose,
  onMessage,
}: {
  board: Board;
  onBoard: (board: Board) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const [columnName, setColumnName] = useState("");
  const [restricted, setRestricted] = useState(board.transitionsRestricted);
  const [rules, setRules] = useState(board.allowedTransitions);
  const [fieldName, setFieldName] = useState("");
  const [fieldKind, setFieldKind] = useState<FieldKind>("text");
  const [listOptions, setListOptions] = useState("");
  const [pinned, setPinned] = useState(false);
  const [cardDisplay, setCardDisplay] = useState(board.cardDisplay);
  const toggleRule = (fromColumnId: string, toColumnId: string) => {
    const exists = rules.some(
      (rule) =>
        rule.fromColumnId === fromColumnId && rule.toColumnId === toColumnId,
    );
    setRules(
      exists
        ? rules.filter(
            (rule) =>
              rule.fromColumnId !== fromColumnId ||
              rule.toColumnId !== toColumnId,
          )
        : [...rules, { fromColumnId, toColumnId }],
    );
  };
  return (
    <div className="dialog-backdrop">
      <section
        className="wide-dialog board-settings"
        role="dialog"
        aria-modal="true"
        aria-label={copy("c195")}
      >
        <header>
          <div>
            <span className="eyebrow">{board.name}</span>
            <h2>{copy("c195")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={copy("c181")}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-grid">
          <section>
            <h3>{copy("c196")}</h3>
            <div className="button-row">
              <input
                aria-label={copy("c197")}
                value={columnName}
                onChange={(event) => setColumnName(event.target.value)}
                placeholder={copy("c198")}
              />

              <button
                className="secondary-button"
                disabled={!columnName.trim()}
                onClick={() =>
                  void addColumnInRepository(board, columnName).then(
                    (updated) => {
                      onBoard(updated);
                      setColumnName("");
                    },
                  )
                }
              >
                <Icon name="add" />
                {copy("c199")}
              </button>
            </div>
            {board.columns.map((column) => (
              <p key={column.id}>
                <span
                  className="color-dot"
                  style={{ background: column.color }}
                />

                {column.name}
              </p>
            ))}
          </section>
          <section>
            <h3>{copy("c200")}</h3>
            <label className="check-row">
              <input
                type="checkbox"
                checked={restricted}
                onChange={(event) => setRestricted(event.target.checked)}
              />{" "}
              {copy("c201")}
            </label>
            {restricted && (
              <div className="transition-matrix">
                {board.columns.flatMap((from) =>
                  board.columns
                    .filter((to) => to.id !== from.id)
                    .map((to) => (
                      <label className="check-row" key={`${from.id}-${to.id}`}>
                        <input
                          type="checkbox"
                          checked={rules.some(
                            (rule) =>
                              rule.fromColumnId === from.id &&
                              rule.toColumnId === to.id,
                          )}
                          onChange={() => toggleRule(from.id, to.id)}
                        />{" "}
                        {from.name} → {to.name}
                      </label>
                    )),
                )}
              </div>
            )}
            <button
              className="secondary-button"
              onClick={() =>
                void setTransitionRulesInRepository(
                  board,
                  restricted,
                  rules,
                ).then((updated) => {
                  onBoard(updated);
                  onMessage(copy("c284"));
                })
              }
            >
              {copy("c202")}
            </button>
          </section>
          <section>
            <h3>{copy("c203")}</h3>
            <label>
              {copy("c182")}

              <input
                value={fieldName}
                onChange={(event) => setFieldName(event.target.value)}
              />
            </label>
            <label>
              {copy("c083")}

              <select
                value={typeof fieldKind === "object" ? "list" : fieldKind}
                onChange={(event) => {
                  const value = event.target.value;
                  setFieldKind(
                    value === "list"
                      ? { list: { options: [] } }
                      : (value as Exclude<
                          FieldKind,
                          { list: { options: string[] } }
                        >),
                  );
                }}
              >
                <option value="text">{copy("c066")}</option>
                <option value="number">{copy("c204")}</option>
                <option value="boolean">{copy("c205")}</option>
                <option value="date">{copy("c206")}</option>
                <option value="secret">{copy("c207")}</option>
                <option value="list">{copy("c208")}</option>
              </select>
            </label>
            {typeof fieldKind === "object" && (
              <label>
                {copy("c209")}

                <textarea
                  value={listOptions}
                  onChange={(event) => {
                    setListOptions(event.target.value);
                    setFieldKind({
                      list: {
                        options: event.target.value
                          .split("\n")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    });
                  }}
                />
              </label>
            )}
            <label className="check-row">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />{" "}
              {copy("c210")}
            </label>
            <button
              className="secondary-button"
              disabled={!fieldName.trim()}
              onClick={() =>
                void addCustomFieldInRepository(
                  board,
                  fieldName,
                  fieldKind,
                  pinned,
                ).then((updated) => {
                  onBoard(updated);
                  setFieldName("");
                  onMessage(copy("c285"));
                })
              }
            >
              {copy("c211")}
            </button>
            {board.customFields.map((field) => (
              <p key={field.id}>
                {field.name}
                {field.pinned && ` · ${copy("c286")}`}
              </p>
            ))}
          </section>
          <section>
            <h3>{copy("c335")}</h3>
            {(
              [
                ["tags", copy("c336")],
                ["priority", copy("c337")],
                ["dueDate", copy("c338")],
                ["source", copy("c339")],
                ["automationStatus", copy("c340")],
              ] as const
            ).map(([key, label]) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={cardDisplay[key]}
                  onChange={(event) =>
                    setCardDisplay((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
            <button
              className="secondary-button"
              onClick={() => {
                const updated = { ...board, cardDisplay };
                onBoard(updated);
                void persistBoard(updated);
                onMessage(copy("c342"));
              }}
            >
              {copy("c341")}
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}

function ArchivesDialog({
  boards,
  onBoards,
  onClose,
  onMessage,
}: {
  boards: Board[];
  onBoards: (boards: Board[]) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<{
    boardId: string;
    taskId: string;
  } | null>(null);
  const archived = boards.flatMap((board) =>
    board.tasks
      .filter((task) => task.archived)
      .map((task) => ({ board, task })),
  );
  const replace = (updated: Board) =>
    onBoards(
      boards.map((board) => (board.id === updated.id ? updated : board)),
    );
  return (
    <div className="dialog-backdrop">
      <section
        className="wide-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy("c005")}
      >
        <header>
          <div>
            <span className="eyebrow">{copy("c212")}</span>
            <h2>{copy("c005")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={copy("c213")}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="archive-list">
          {archived.map(({ board, task }) => (
            <article key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <small>{board.name}</small>
              </div>
              <button
                className="secondary-button"
                onClick={() =>
                  void restoreTaskInRepository(board.id, task.id).then(
                    (updated) => {
                      replace(updated);
                      onMessage(copy("c287"));
                    },
                  )
                }
              >
                <Icon name="unarchive" />
                {copy("c214")}
              </button>
              <button
                className="text-button danger"
                onClick={() =>
                  setConfirmDelete({ boardId: board.id, taskId: task.id })
                }
              >
                <Icon name="delete_forever" />
                {copy("c215")}
              </button>
            </article>
          ))}
          {!archived.length && (
            <div className="pane-empty">
              <Icon name="inventory_2" />
              <p>{copy("c216")}</p>
            </div>
          )}
        </div>
        {confirmDelete && (
          <div
            className="danger-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={copy("c217")}
          >
            <p>{copy("c218")}</p>
            <div>
              <button
                className="text-button"
                onClick={() => setConfirmDelete(null)}
              >
                {copy("c012")}
              </button>
              <button
                className="primary-button danger-fill"
                onClick={() =>
                  void deleteTaskPermanently(
                    confirmDelete.boardId,
                    confirmDelete.taskId,
                  ).then((updated) => {
                    replace(updated);
                    setConfirmDelete(null);
                    onMessage(copy("c288"));
                  })
                }
              >
                {copy("c219")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsDialog({
  boards,
  pendingImportPath,
  onClose,
  onBoards,
  onMessage,
}: {
  boards: Board[];
  pendingImportPath: string | null;
  onClose: () => void;
  onBoards: (boards: Board[]) => void;
  onMessage: (message: string) => void;
}) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupInfo | null>(
    null,
  );
  const [autostart, setAutostart] = useState(false);
  const [notifications, setNotifications] = useState({
    failure: true,
    confirmation: true,
    source: true,
    success: false,
  });
  const [importPath, setImportPath] = useState<string | null>(
    pendingImportPath,
  );
  const [importPreview, setImportPreview] = useState<ImportResult | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [decisions, setDecisions] = useState<
    Record<string, "update" | "copy" | "ignore">
  >({});
  const [trust, setTrust] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [selectedBoardIds, setSelectedBoardIds] = useState(() =>
    boards.map((board) => board.id),
  );
  const [includeActions, setIncludeActions] = useState(true);
  const [includeSources, setIncludeSources] = useState(true);
  const [includeTriggers, setIncludeTriggers] = useState(true);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [logMaxMegabytes, setLogMaxMegabytes] = useState(100);
  const importedBoards = importPreview?.bundle.boards ?? [];
  const environmentKey = (value: string) =>
    value
      .split("")
      .map((character) =>
        /[a-z0-9]/i.test(character) ? character.toUpperCase() : "_",
      )
      .join("");
  const commandTrustSummary = (command: CommandAction) =>
    `\n${command.runner}\n${command.workingDirectory ?? copy("c295")}\n${command.script}\n${command.variants
      .map(
        (variant) =>
          `${copy("c350", { platform: variant.operatingSystem })}\n${variant.runner}\n${variant.script}`,
      )
      .join(
        "\n",
      )}\n${copy("c351")}: ${command.arguments.join(" ") || "—"}\n${copy("c352")}: ${command.directExecution ? copy("c353") : copy("c354")}\nWORKONIT_*: WORKONIT_TASK_ID, WORKONIT_TITLE, WORKONIT_DESCRIPTION, WORKONIT_COLUMN_ID${[
      ...boards,
      ...importedBoards,
    ]
      .flatMap((board) => board.customFields)
      .map((field) => `, WORKONIT_FIELD_${environmentKey(field.id)}`)
      .join(
        "",
      )}\nSecrets: ${command.secretNames.map((name) => `WORKONIT_SECRET_${environmentKey(name)}`).join(", ") || "—"}\n${copy("c355")}`;

  const loadImport = (path: string) => {
    setImportPath(path);
    void Promise.all([previewImportFile(path), previewImportConflicts(path)])
      .then(([preview, nextConflicts]) => {
        setImportPreview(preview);
        setConflicts(nextConflicts);
        setDecisions(
          Object.fromEntries(
            nextConflicts.map(
              (conflict) =>
                [`${conflict.kind}:${conflict.id}`, "update"] as const,
            ),
          ),
        );
      })
      .catch((error: unknown) => onMessage(String(error)));
  };

  useEffect(() => {
    void listBackups().then(setBackups);
    void Promise.all([
      getSetting("notifications.failure"),
      getSetting("notifications.confirmation"),
      getSetting("notifications.source_blocked"),
      getSetting("notifications.success"),
      getSetting("logs.retention_days"),
      getSetting("logs.max_megabytes"),
    ]).then(
      ([failure, confirmation, source, success, retention, maxMegabytes]) => {
        setNotifications({
          failure: failure !== "false",
          confirmation: confirmation !== "false",
          source: source !== "false",
          success: success === "true",
        });
        setLogRetentionDays(Number(retention) || 30);
        setLogMaxMegabytes(Number(maxMegabytes) || 100);
      },
    );
    if (isDesktopRuntime()) {
      void import("@tauri-apps/plugin-autostart")
        .then(({ isEnabled }) => isEnabled())
        .then(setAutostart);
    }
    if (pendingImportPath) loadImport(pendingImportPath);
  }, [pendingImportPath]);

  const chooseImport = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [{ name: "WorkOnIt", extensions: ["workonit"] }],
    });
    if (typeof selected === "string") loadImport(selected);
  };
  const exportData = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      defaultPath: "workonit-export.workonit",
      filters: [{ name: "WorkOnIt", extensions: ["workonit"] }],
    });
    if (selected) {
      await writeExportFile(selected, includeHistory, {
        boardIds: selectedBoardIds,
        includeActions,
        includeSources,
        includeTriggers,
      });
      onMessage(copy("c289"));
    }
  };
  const applyImport = async () => {
    const selectedPath = importPath!;
    const selectedPreview = importPreview!;
    const merged = await applyImportFile(
      selectedPath,
      conflicts.map((conflict) => ({
        id: conflict.id,
        kind: conflict.kind,
        resolution: decisions[`${conflict.kind}:${conflict.id}`],
      })),
    );
    if (trust) {
      await trustImportedCommands(
        selectedPreview.trustRequiredActions,
        selectedPreview.trustRequiredSources,
      );
    }
    onBoards(merged.boards);
    onMessage(copy("c290"));
    setImportPreview(null);
    setImportPath(null);
    setBackups(await listBackups());
  };
  const toggleNotification = (key: keyof typeof notifications) => {
    const value = !notifications[key];
    setNotifications((current) => ({ ...current, [key]: value }));
    const setting: SettingKey =
      key === "source"
        ? "notifications.source_blocked"
        : `notifications.${key}`;
    void setSetting(setting, String(value));
  };

  return (
    <div className="dialog-backdrop">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy("c220")}
      >
        <header>
          <div>
            <span className="eyebrow">{copy("c221")}</span>
            <h2>{copy("c006")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={copy("c222")}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-grid">
          <section>
            <h3>{copy("c223")}</h3>
            <label className="check-row">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(event) => {
                  const value = event.target.checked;
                  setAutostart(value);
                  if (isDesktopRuntime())
                    void import("@tauri-apps/plugin-autostart").then(
                      ({ enable, disable }) => (value ? enable() : disable()),
                    );
                }}
              />{" "}
              {copy("c224")}
            </label>
            <p>{copy("c225")}</p>
          </section>
          <section>
            <h3>{copy("c226")}</h3>
            {(
              [
                ["failure", copy("c291")],
                ["confirmation", copy("c292")],
                ["source", copy("c293")],
                ["success", copy("c294")],
              ] as const
            ).map(([key, label]) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  onChange={() => toggleNotification(key)}
                />{" "}
                {label}
              </label>
            ))}
          </section>
          <section>
            <h3>{copy("c227")}</h3>
            <label>
              {copy("c228")}

              <input
                type="number"
                min="0"
                value={logRetentionDays}
                onChange={(event) => {
                  const value = Math.max(0, Number(event.target.value));
                  setLogRetentionDays(value);
                  void setSetting("logs.retention_days", String(value));
                }}
              />
            </label>
            <label>
              {copy("c229")}

              <input
                type="number"
                min="1"
                value={logMaxMegabytes}
                onChange={(event) => {
                  const value = Math.max(1, Number(event.target.value));
                  setLogMaxMegabytes(value);
                  void setSetting("logs.max_megabytes", String(value));
                }}
              />
            </label>
            <p>{copy("c230")}</p>
          </section>
          <section>
            <h3>{copy("c231")}</h3>
            <fieldset>
              <legend>{copy("c345")}</legend>
              {boards.map((board) => (
                <label className="check-row" key={board.id}>
                  <input
                    type="checkbox"
                    checked={selectedBoardIds.includes(board.id)}
                    onChange={(event) =>
                      setSelectedBoardIds((current) =>
                        event.target.checked
                          ? [...current, board.id]
                          : current.filter((id) => id !== board.id),
                      )
                    }
                  />{" "}
                  {board.name}
                </label>
              ))}
            </fieldset>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeActions}
                onChange={(event) => setIncludeActions(event.target.checked)}
              />{" "}
              {copy("c346")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeSources}
                onChange={(event) => setIncludeSources(event.target.checked)}
              />{" "}
              {copy("c347")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeTriggers}
                disabled={!includeSources}
                onChange={(event) => setIncludeTriggers(event.target.checked)}
              />{" "}
              {copy("c348")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(event) => setIncludeHistory(event.target.checked)}
              />{" "}
              {copy("c232")}
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={selectedBoardIds.length === 0}
                onClick={() => void exportData()}
              >
                <Icon name="download" />
                {copy("c233")}
              </button>
              <button
                className="secondary-button"
                onClick={() => void chooseImport()}
              >
                <Icon name="upload" />
                {copy("c119")}
              </button>
            </div>
            {importPreview && (
              <div className="import-preview">
                <h4>{copy("c234")}</h4>
                <p>
                  {importPreview.bundle.boards.length}
                  {copy("c235")} {importPreview.bundle.actions.length}
                  {copy("c236")} {importPreview.bundle.sources.length}
                  {copy("c237")}
                </p>
                {importPreview.bundle.actions
                  .filter((action) =>
                    importPreview.trustRequiredActions.includes(action.id),
                  )
                  .map((action) => (
                    <pre key={action.id}>
                      <strong>{action.name}</strong>
                      {commandTrustSummary(action)}
                    </pre>
                  ))}
                {importPreview.bundle.sources
                  .filter((source) =>
                    importPreview.trustRequiredSources.includes(source.id),
                  )
                  .map((source) => (
                    <pre key={source.id}>
                      <strong>{source.name}</strong>
                      {commandTrustSummary(source.command)}
                    </pre>
                  ))}
                {conflicts.map((conflict) => (
                  <label key={`${conflict.kind}:${conflict.id}`}>
                    {conflict.name}
                    <select
                      value={decisions[`${conflict.kind}:${conflict.id}`]}
                      onChange={(event) =>
                        setDecisions((current) => ({
                          ...current,
                          [`${conflict.kind}:${conflict.id}`]: event.target
                            .value as "update" | "copy" | "ignore",
                        }))
                      }
                    >
                      <option value="update">{copy("c238")}</option>
                      <option value="copy">{copy("c239")}</option>
                      <option value="ignore">{copy("c240")}</option>
                    </select>
                  </label>
                ))}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={trust}
                    onChange={(event) => setTrust(event.target.checked)}
                  />{" "}
                  {copy("c241")}
                </label>
                <button
                  className="primary-button"
                  onClick={() => void applyImport()}
                >
                  {copy("c242")}
                </button>
              </div>
            )}
          </section>
          <section>
            <h3>{copy("c243")}</h3>
            <button
              className="secondary-button"
              onClick={() =>
                void createBackup().then(async () =>
                  setBackups(await listBackups()),
                )
              }
            >
              <Icon name="backup" />
              {copy("c244")}
            </button>
            <div className="backup-list">
              {backups.map((backup) => (
                <button
                  key={backup.path}
                  onClick={() => setRestoreCandidate(backup)}
                >
                  <span>{backup.name}</span>
                  <small>
                    {Math.ceil(backup.bytes / 1024)}
                    {copy("c245")}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
        {restoreCandidate && (
          <div
            className="danger-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label={copy("c246")}
          >
            <p>
              {copy("c214")}
              {restoreCandidate.name}
              {copy("c247")}
            </p>
            <div>
              <button
                className="text-button"
                onClick={() => setRestoreCandidate(null)}
              >
                {copy("c012")}
              </button>
              <button
                className="primary-button danger-fill"
                onClick={() =>
                  void restoreBackup(restoreCandidate.path).then((updated) => {
                    onBoards(updated);
                    setRestoreCandidate(null);
                    onMessage(copy("c297"));
                  })
                }
              >
                {copy("c214")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
