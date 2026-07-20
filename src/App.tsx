import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { copy } from "./i18n";
import { useDialogFocusTrap } from "./hooks/useDialogFocusTrap";
import { Masthead } from "./components/Masthead";
import { BoardHeader } from "./components/BoardHeader";
import { Snackbar } from "./components/Snackbar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EmptyState } from "./components/EmptyState";
import { BoardSkeleton } from "./components/BoardSkeleton";
import { BoardView } from "./components/BoardView";
import { TaskPanel } from "./components/TaskPanel";
import { CreateDialog } from "./components/CreateDialog";
import { type Theme } from "./components/ThemeButton";
import { type Language } from "./components/LanguageSelect";
import { CommandPalette } from "./components/CommandPalette";
import { ColumnPanel } from "./components/ColumnPanel";
import { SourcesPage } from "./pages/SourcesPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { BoardSettingsPage } from "./pages/BoardSettingsPage";
import { ArchivesPage } from "./pages/ArchivesPage";
import { SettingsPage } from "./pages/SettingsPage";
import {
  addTaskInRepository,
  archiveTaskInRepository,
  cancelTaskExecution,
  createBoardInRepository,
  initialBoards,
  isDesktopRuntime,
  loadBoards,
  moveTaskOnBackend,
  persistBoard,
  reorderTaskInRepository,
  setCustomValueInRepository,
  takePendingImports,
  updateTaskInRepository,
} from "./lib/repository";
import { type Board, type Page, type Task } from "./lib/types";
import "./styles.css";

type Dialog = "board" | "task" | null;

export default function App() {
  useDialogFocusTrap();
  const { i18n } = useTranslation();
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [boardId, setBoardId] = useState(() => initialBoards()[0]?.id ?? "");
  const [page, setPage] = useState<Page>("boards");
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
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(
    null,
  );
  const [pendingMove, setPendingMove] = useState<{
    taskId: string;
    target: string;
  } | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
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
        setPage("settings");
      }
    });
    if (!isDesktopRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<string[]>("import-file-requested", ({ payload }) => {
      if (payload[0]) {
        setPendingImportPath(payload[0]);
        setPage("settings");
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
    if (page !== "settings") setPendingImportPath(null);
  }, [page]);

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
      <Masthead
        page={page}
        boards={boards}
        activeBoardId={board?.id}
        theme={theme}
        language={language}
        onNavigate={(nextPage) => {
          setPage(nextPage);
          setSelectedTaskId(null);
        }}
        onSelectBoard={(nextBoardId) => {
          setBoardId(nextBoardId);
          setPage("boards");
          setSelectedTaskId(null);
        }}
        onCreateBoard={() => setDialog("board")}
        onTheme={setTheme}
        onLanguage={setLanguage}
      />

      <main className="main-area">
        {page === "boards" && (
          <BoardHeader
            board={board}
            search={search}
            onSearch={setSearch}
            onOpenSettings={() => setPage("board-settings")}
            onNewTask={() => {
              setTaskColumnId(board!.columns[0].id);
              setDialog("task");
            }}
          />
        )}

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
        {page === "archives" && (
          <ArchivesPage
            boards={boards}
            onBoards={setBoards}
            onMessage={setToast}
          />
        )}
        {page === "board-settings" && board && (
          <BoardSettingsPage
            key={board.id}
            board={board}
            onBoard={replaceBoard}
            onClose={() => setPage("boards")}
            onMessage={setToast}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            boards={boards}
            pendingImportPath={pendingImportPath}
            onBoards={(updated) => {
              setBoards(updated);
              setBoardId(updated[0]?.id ?? "");
            }}
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
      {pendingMove && (
        <ConfirmDialog
          ariaLabel={copy("c010")}
          title={copy("c010")}
          description={copy("c011")}
          confirmLabel={copy("c013")}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => {
            moveTask(pendingMove.taskId, pendingMove.target, true);
            setPendingMove(null);
          }}
        />
      )}
      {toast && (
        <Snackbar
          message={toast}
          onRetry={
            retry
              ? () => {
                  setToast(null);
                  retry();
                }
              : undefined
          }
          onClose={() => {
            setToast(null);
            setRetry(null);
          }}
        />
      )}
    </div>
  );
}
