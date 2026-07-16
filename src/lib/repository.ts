import {
  createBoard,
  createTask,
  type Board,
  type CustomFieldValue,
  type FieldKind,
  type Task,
  type WipPolicy,
} from "./types";
import type {
  AutomationDraft,
  BackupInfo,
  CommandAction,
  CommandPreview,
  ExecutionRecord,
  SchedulerJournalEntry,
  ImportResult,
  ImportConflict,
  SourceDefinition,
  SourceFormat,
  SourcePreview,
  TriggerDefinition,
} from "./backend-types";

const BOARDS_KEY = "workonit.boards";
const ACTIONS_KEY = "workonit.actions";
const SOURCES_KEY = "workonit.sources";

function localBoards(): Board[] {
  try {
    const boards = JSON.parse(
      localStorage.getItem(BOARDS_KEY) ?? "[]",
    ) as Board[];
    return boards.map((board) => ({
      ...board,
      cardDisplay: board.cardDisplay ?? {
        tags: true,
        priority: true,
        dueDate: true,
        source: true,
        automationStatus: true,
      },
    }));
  } catch {
    return [];
  }
}

function cacheBoard(board: Board): void {
  const boards = localBoards();
  const index = boards.findIndex((candidate) => candidate.id === board.id);
  if (index >= 0) boards[index] = board;
  else boards.push(board);
  localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
}

export function initialBoards(): Board[] {
  return localBoards();
}

export function isDesktopRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function loadBoards(): Promise<Board[]> {
  if (!("__TAURI_INTERNALS__" in window)) return localBoards();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<Board[]>("list_boards");
  } catch {
    return localBoards();
  }
}

export async function persistBoard(board: Board): Promise<void> {
  cacheBoard(board);
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_board", { board });
  }
}

export async function createBoardInRepository(name: string): Promise<Board> {
  if (!isDesktopRuntime()) {
    const board = createBoard(name);
    await persistBoard(board);
    return board;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const board = await invoke<Board>("create_board", { name });
  cacheBoard(board);
  return board;
}

export async function addTaskInRepository(
  board: Board,
  columnId: string,
  title: string,
): Promise<Board> {
  if (!isDesktopRuntime()) {
    const position = board.tasks.filter(
      (task) => task.columnId === columnId && !task.archived,
    ).length;
    const updated = {
      ...board,
      tasks: [...board.tasks, createTask(title, columnId, position)],
    };
    await persistBoard(updated);
    return updated;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const updated = await invoke<Board>("add_task", {
    boardId: board.id,
    columnId,
    title,
  });
  cacheBoard(updated);
  return updated;
}

export async function updateTaskInRepository(
  board: Board,
  task: Task,
): Promise<Board> {
  if (!isDesktopRuntime()) {
    const updated = {
      ...board,
      tasks: board.tasks.map((item) => (item.id === task.id ? task : item)),
    };
    await persistBoard(updated);
    return updated;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const updated = await invoke<Board>("update_task", {
    boardId: board.id,
    task,
  });
  cacheBoard(updated);
  return updated;
}

export async function reorderTaskInRepository(
  board: Board,
  taskId: string,
  position: number,
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("reorder_task", {
      boardId: board.id,
      taskId,
      position,
    });
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task) return board;
  const ordered = board.tasks
    .filter((item) => item.columnId === task.columnId && !item.archived)
    .sort((left, right) => left.position - right.position);
  const current = ordered.findIndex((item) => item.id === taskId);
  if (current < 0 || position < 0 || position >= ordered.length) return board;
  const [moved] = ordered.splice(current, 1);
  ordered.splice(position, 0, moved);
  const positions = new Map(ordered.map((item, index) => [item.id, index]));
  const updated = {
    ...board,
    tasks: board.tasks.map((item) =>
      positions.has(item.id)
        ? { ...item, position: positions.get(item.id)! }
        : item,
    ),
  };
  await persistBoard(updated);
  return updated;
}

export async function archiveTaskInRepository(
  board: Board,
  taskId: string,
): Promise<Board> {
  if (!isDesktopRuntime()) {
    const updated = {
      ...board,
      tasks: board.tasks.map((task) =>
        task.id === taskId ? { ...task, archived: true } : task,
      ),
    };
    await persistBoard(updated);
    return updated;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const updated = await invoke<Board>("archive_task", {
    boardId: board.id,
    taskId,
  });
  cacheBoard(updated);
  return updated;
}

export async function addColumnInRepository(
  board: Board,
  name: string,
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("add_column", {
      boardId: board.id,
      name,
      wipPolicy: { kind: "none" },
    });
  const updated = {
    ...board,
    columns: [
      ...board.columns,
      {
        id: crypto.randomUUID(),
        name,
        color: "#65558f",
        position: board.columns.length,
        wipPolicy: { kind: "none" } as WipPolicy,
      },
    ],
  };
  await persistBoard(updated);
  return updated;
}

export async function configureColumnInRepository(
  board: Board,
  columnId: string,
  name: string,
  color: string,
  wipPolicy: WipPolicy,
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("configure_column", {
      boardId: board.id,
      columnId,
      name,
      color,
      wipPolicy,
    });
  const updated = {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, name, color, wipPolicy } : column,
    ),
  };
  await persistBoard(updated);
  return updated;
}

export async function deleteColumnInRepository(
  board: Board,
  columnId: string,
  destinationId: string,
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("delete_column", {
      boardId: board.id,
      columnId,
      destinationId,
    });
  const updated = {
    ...board,
    columns: board.columns.filter((column) => column.id !== columnId),
    tasks: board.tasks.map((task) =>
      task.columnId === columnId ? { ...task, columnId: destinationId } : task,
    ),
    allowedTransitions: board.allowedTransitions.filter(
      (rule) => rule.fromColumnId !== columnId && rule.toColumnId !== columnId,
    ),
  };
  await persistBoard(updated);
  return updated;
}

export async function setTransitionRulesInRepository(
  board: Board,
  restricted: boolean,
  rules: Board["allowedTransitions"],
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("set_transition_rules", {
      boardId: board.id,
      restricted,
      rules,
    });
  const updated = {
    ...board,
    transitionsRestricted: restricted,
    allowedTransitions: rules,
  };
  await persistBoard(updated);
  return updated;
}

export async function addCustomFieldInRepository(
  board: Board,
  name: string,
  kind: FieldKind,
  pinned: boolean,
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("add_custom_field", {
      boardId: board.id,
      name,
      kind,
      pinned,
    });
  const updated = {
    ...board,
    customFields: [
      ...board.customFields,
      { id: crypto.randomUUID(), name, kind, pinned },
    ],
  };
  await persistBoard(updated);
  return updated;
}

export async function setCustomValueInRepository(
  board: Board,
  taskId: string,
  fieldId: string,
  value: CustomFieldValue,
): Promise<Board> {
  if (isDesktopRuntime())
    return invokeDesktop("set_custom_value", {
      boardId: board.id,
      taskId,
      fieldId,
      value,
    });
  const updated = {
    ...board,
    tasks: board.tasks.map((task) =>
      task.id === taskId
        ? { ...task, customValues: { ...task.customValues, [fieldId]: value } }
        : task,
    ),
  };
  await persistBoard(updated);
  return updated;
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (isDesktopRuntime()) await invokeDesktop("set_secret", { name, value });
}

export async function moveTaskOnBackend(
  boardId: string,
  taskId: string,
  columnId: string,
  confirmed = false,
): Promise<Board> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Board>("move_task", {
    boardId,
    taskId,
    columnId,
    origin: "user",
    confirmed,
  }).then((board) => {
    cacheBoard(board);
    return board;
  });
}

async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function localList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function saveLocalItem<T extends { id: string }>(key: string, item: T): void {
  const values = localList<T>(key);
  const index = values.findIndex((value) => value.id === item.id);
  if (index >= 0) values[index] = item;
  else values.push(item);
  localStorage.setItem(key, JSON.stringify(values));
}

export function newCommandAction(name = "Nouvelle action"): CommandAction {
  return {
    id: crypto.randomUUID(),
    name,
    script: "",
    runner: navigator.userAgent.includes("Windows") ? "powershell" : "/bin/zsh",
    loadProfile: false,
    timeoutSeconds: 300,
    acceptedExitCodes: [0],
    stopOnFailure: true,
    destructive: false,
    enabled: false,
    variants: [],
    secretNames: [],
    directExecution: false,
    arguments: [],
    outputLimitBytes: 10 * 1024 * 1024,
  };
}

export async function loadActions(): Promise<CommandAction[]> {
  return isDesktopRuntime()
    ? invokeDesktop("list_actions")
    : localList(ACTIONS_KEY);
}

export async function saveActionInRepository(
  action: CommandAction,
): Promise<void> {
  if (isDesktopRuntime()) await invokeDesktop("save_action", { action });
  saveLocalItem(ACTIONS_KEY, action);
}

export function newSource(board: Board): SourceDefinition {
  const name = "Nouvelle source";
  return {
    id: crypto.randomUUID(),
    boardId: board.id,
    name,
    command: newCommandAction(name),
    format: "json",
    mapping: { title: "$.title", externalKey: "$.id" },
    customFieldMapping: {},
    allowedUpdateCustomFields: [],
    initialColumnId: board.columns[0]?.id ?? "",
    columnMapping: {},
    allowedUpdateFields: ["title", "description"],
    moveExistingTasks: false,
    acceptPartial: false,
    absenceThreshold: 3,
    outputLimitBytes: 10 * 1024 * 1024,
    encoding: "utf8",
    enabled: false,
  };
}

export async function loadSources(
  boardId: string,
): Promise<SourceDefinition[]> {
  const sources = isDesktopRuntime()
    ? await invokeDesktop<SourceDefinition[]>("list_sources", { boardId })
    : localList<SourceDefinition>(SOURCES_KEY).filter(
        (source) => source.boardId === boardId,
      );
  return sources.map((source) => ({
    ...source,
    customFieldMapping: source.customFieldMapping ?? {},
    allowedUpdateCustomFields: source.allowedUpdateCustomFields ?? [],
  }));
}

export async function saveSourceInRepository(
  source: SourceDefinition,
): Promise<void> {
  if (isDesktopRuntime()) await invokeDesktop("save_source", { source });
  saveLocalItem(SOURCES_KEY, source);
}

export async function runSourceNow(
  sourceId: string,
  forceImport = false,
  allowTruncated = false,
): Promise<{
  preview: SourcePreview;
  import?: { created: number; updated: number };
}> {
  return invokeDesktop("run_source_now", {
    sourceId,
    forceImport,
    allowTruncated,
  });
}

export async function inspectSourceNow(sourceId: string): Promise<{
  preview: SourcePreview;
  output: { exitCode?: number; truncated: boolean; encodingErrors: boolean };
}> {
  return invokeDesktop("inspect_source_now", { sourceId });
}

export async function applySourceResult(
  sourceId: string,
  preview: SourcePreview,
): Promise<Board> {
  return invokeDesktop("apply_source_result", {
    sourceId,
    preview,
    confirmed: true,
  });
}

export async function cancelSourceExecution(sourceId: string): Promise<void> {
  await invokeDesktop("cancel_source_execution", { sourceId });
}

export async function loadTriggers(
  sourceId: string,
): Promise<TriggerDefinition[]> {
  return isDesktopRuntime() ? invokeDesktop("list_triggers", { sourceId }) : [];
}

export async function saveTriggerInRepository(
  trigger: TriggerDefinition,
): Promise<void> {
  if (isDesktopRuntime()) await invokeDesktop("save_trigger", { trigger });
}

export async function previewSourceInRepository(
  format: SourceFormat,
  input: string,
  mapping: SourceDefinition["mapping"],
  textPattern?: string,
): Promise<SourcePreview> {
  if (isDesktopRuntime()) {
    return invokeDesktop("preview_source", {
      format,
      input,
      mapping,
      textPattern,
    });
  }
  const records: SourcePreview["records"] = [];
  const errors: SourcePreview["errors"] = [];
  if (format === "text") {
    try {
      const regex = new RegExp(textPattern ?? "");
      input.split(/\r?\n/).forEach((line, index) => {
        const match = regex.exec(line);
        if (match?.groups?.title)
          records.push({
            title: match.groups.title,
            description: match.groups.description ?? "",
            externalKey: match.groups.external_key,
            sourceLine: index + 1,
          });
        else errors.push({ line: index + 1, message: "Aucune correspondance" });
      });
    } catch (error) {
      errors.push({ line: 0, message: String(error) });
    }
  } else {
    const lines =
      format === "jsonl" ? input.split(/\r?\n/).filter(Boolean) : [input];
    lines.forEach((line, index) => {
      try {
        const parsed: unknown = JSON.parse(line);
        const values = Array.isArray(parsed) ? parsed : [parsed];
        values.forEach((value) => {
          const record = value as Record<string, unknown>;
          const title = record.title;
          if (typeof title === "string")
            records.push({
              title,
              description:
                typeof record.description === "string"
                  ? record.description
                  : "",
              externalKey:
                typeof record.id === "string" ? record.id : undefined,
              sourceLine: index + 1,
            });
          else errors.push({ line: index + 1, message: "Titre introuvable" });
        });
      } catch (error) {
        errors.push({ line: index + 1, message: String(error) });
      }
    });
  }
  return {
    records,
    errors,
    warnings: records.some((record) => !record.externalKey)
      ? ["Clé externe absente"]
      : [],
  };
}

export async function loadAutomationDrafts(
  boardId: string,
): Promise<AutomationDraft[]> {
  return isDesktopRuntime()
    ? invokeDesktop("list_automation_drafts", { boardId })
    : [];
}

export async function saveAutomationDraftInRepository(
  draft: AutomationDraft,
): Promise<void> {
  if (isDesktopRuntime())
    await invokeDesktop("save_automation_draft", { draft });
}

export async function previewAutomationDraft(
  automationId: string,
): Promise<CommandPreview[]> {
  if (isDesktopRuntime())
    return invokeDesktop("preview_automation_draft", { automationId });
  const actions = await loadActions();
  return actions.map((action) => ({
    actionId: action.id,
    actionName: action.name,
    runner: action.runner,
    script: action.script,
    workingDirectory: action.workingDirectory,
    environmentVariables: [
      "WORKONIT_TASK_ID",
      "WORKONIT_TITLE",
      "WORKONIT_DESCRIPTION",
      "WORKONIT_COLUMN_ID",
    ],
    secretNames: action.secretNames,
  }));
}

export async function testAutomationDraft(
  automationId: string,
  taskId: string,
): Promise<{ status: string }> {
  return invokeDesktop("test_automation_draft", {
    automationId,
    taskId,
    confirmed: true,
  });
}

export async function activateAutomationDraft(
  automationId: string,
): Promise<void> {
  await invokeDesktop("activate_automation_draft", { automationId });
}

export async function loadExecutions(): Promise<ExecutionRecord[]> {
  return isDesktopRuntime() ? invokeDesktop("list_executions") : [];
}

export async function loadSchedulerJournal(): Promise<SchedulerJournalEntry[]> {
  return isDesktopRuntime() ? invokeDesktop("list_scheduler_journal") : [];
}

export async function resumeExecutionInRepository(
  boardId: string,
  executionId: string,
  restartAll: boolean,
): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invokeDesktop("resume_execution", {
    boardId,
    executionId,
    restartAll,
  });
}

export async function abandonExecutionInRepository(
  boardId: string,
  executionId: string,
): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invokeDesktop("abandon_execution", { boardId, executionId });
}

export async function cancelTaskExecution(taskId: string): Promise<void> {
  await invokeDesktop("cancel_task_execution", { taskId });
}

export async function restoreTaskInRepository(
  boardId: string,
  taskId: string,
): Promise<Board> {
  if (!isDesktopRuntime()) {
    const board = localBoards().find((value) => value.id === boardId);
    if (!board) throw new Error("Kanban introuvable");
    const updated = {
      ...board,
      tasks: board.tasks.map((task) =>
        task.id === taskId ? { ...task, archived: false } : task,
      ),
    };
    await persistBoard(updated);
    return updated;
  }
  return invokeDesktop("restore_task", { boardId, taskId });
}

export async function deleteTaskPermanently(
  boardId: string,
  taskId: string,
): Promise<Board> {
  if (!isDesktopRuntime()) {
    const board = localBoards().find((value) => value.id === boardId);
    if (!board) throw new Error("Kanban introuvable");
    const updated = {
      ...board,
      tasks: board.tasks.filter((task) => task.id !== taskId),
    };
    await persistBoard(updated);
    return updated;
  }
  return invokeDesktop("permanently_delete_task", {
    boardId,
    taskId,
    confirmed: true,
  });
}

export async function listBackups(): Promise<BackupInfo[]> {
  return isDesktopRuntime() ? invokeDesktop("list_backups") : [];
}

export async function createBackup(): Promise<BackupInfo | null> {
  return isDesktopRuntime() ? invokeDesktop("create_backup") : null;
}

export async function restoreBackup(path: string): Promise<Board[]> {
  return invokeDesktop("restore_backup", { path });
}

export type SettingKey =
  | "notifications.failure"
  | "notifications.confirmation"
  | "notifications.source_blocked"
  | "notifications.success"
  | "logs.retention_days"
  | "logs.max_megabytes";

export async function getSetting(key: SettingKey): Promise<string | undefined> {
  return isDesktopRuntime()
    ? invokeDesktop<string | null>("get_setting", { key }).then(
        (value) => value ?? undefined,
      )
    : (localStorage.getItem(`setting.${key}`) ?? undefined);
}

export async function setSetting(
  key: SettingKey,
  value: string,
): Promise<void> {
  if (isDesktopRuntime()) await invokeDesktop("set_setting", { key, value });
  else localStorage.setItem(`setting.${key}`, value);
}

export async function previewImportFile(path: string): Promise<ImportResult> {
  return invokeDesktop("preview_import_file", { path });
}

export async function previewImportConflicts(
  path: string,
): Promise<ImportConflict[]> {
  return invokeDesktop("preview_import_conflicts", { path });
}

export async function applyImportFile(
  path: string,
  decisions: Array<{
    id: string;
    kind: ImportConflict["kind"];
    resolution: "update" | "copy" | "ignore";
  }>,
): Promise<{ boards: Board[] }> {
  return invokeDesktop("apply_import_file", { path, decisions });
}

export async function trustImportedCommands(
  actionIds: string[],
  sourceIds: string[],
): Promise<void> {
  await invokeDesktop("trust_imported_commands", {
    actionIds,
    sourceIds,
    confirmed: true,
  });
}

export async function writeExportFile(
  path: string,
  includeHistory: boolean,
  options: {
    boardIds: string[];
    includeActions: boolean;
    includeSources: boolean;
    includeTriggers: boolean;
  },
): Promise<void> {
  await invokeDesktop("write_export_file", {
    path,
    includeHistory,
    selection: options,
  });
}

export async function takePendingImports(): Promise<string[]> {
  return isDesktopRuntime() ? invokeDesktop("take_pending_imports") : [];
}
