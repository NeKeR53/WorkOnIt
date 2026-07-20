import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBoard, createTask, type Board } from "./types";
import type {
  AutomationDraft,
  CommandAction,
  SourcePreview,
} from "./backend-types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import * as repository from "./repository";

const desktop = (enabled: boolean) => {
  if (enabled)
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  else
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};

function boardWithTasks(): Board {
  const board = createBoard("Test");
  board.tasks = [
    createTask("One", board.columns[0].id, 0),
    createTask("Two", board.columns[0].id, 1),
  ];
  return board;
}

describe("repository web fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    desktop(false);
    invoke.mockReset();
  });

  it("persists boards and performs every local board mutation", async () => {
    expect(repository.isDesktopRuntime()).toBe(false);
    expect(repository.initialBoards()).toEqual([]);
    localStorage.setItem("workonit.boards", "not-json");
    expect(await repository.loadBoards()).toEqual([]);

    const created = await repository.createBoardInRepository(" Local ");
    expect(created.name).toBe("Local");
    await repository.persistBoard({ ...created, name: "Replaced" });
    expect(repository.initialBoards()).toHaveLength(1);
    const legacy = { ...created } as Partial<Board>;
    delete legacy.cardDisplay;
    localStorage.setItem("workonit.boards", JSON.stringify([legacy]));
    expect(repository.initialBoards()[0].cardDisplay).toEqual({
      tags: true,
      priority: true,
      dueDate: true,
      source: true,
      automationStatus: true,
    });

    let board = await repository.addTaskInRepository(
      { ...created, tasks: [] },
      created.columns[0].id,
      "Task",
    );
    const task = { ...board.tasks[0], title: "Updated" };
    board = await repository.updateTaskInRepository(board, task);
    expect(board.tasks[0].title).toBe("Updated");

    const ordered = boardWithTasks();
    expect(
      await repository.reorderTaskInRepository(ordered, "missing", 0),
    ).toBe(ordered);
    expect(
      await repository.reorderTaskInRepository(ordered, ordered.tasks[0].id, 9),
    ).toBe(ordered);
    board = await repository.reorderTaskInRepository(
      {
        ...ordered,
        tasks: [
          ...ordered.tasks,
          createTask("Elsewhere", ordered.columns[1].id, 0),
        ],
      },
      ordered.tasks[1].id,
      0,
    );
    expect(board.tasks.find((item) => item.title === "Two")?.position).toBe(0);

    board = await repository.archiveTaskInRepository(board, board.tasks[0].id);
    expect(board.tasks[0].archived).toBe(true);
    board = await repository.addColumnInRepository(board, "Review");
    const added = board.columns.at(-1)!;
    board = await repository.configureColumnInRepository(
      board,
      added.id,
      "QA",
      "#fff",
      { kind: "hard", limit: 1 },
    );
    board.tasks[0].columnId = added.id;
    board.allowedTransitions = [
      { fromColumnId: added.id, toColumnId: board.columns[0].id },
      { fromColumnId: board.columns[0].id, toColumnId: added.id },
      { fromColumnId: board.columns[0].id, toColumnId: board.columns[1].id },
    ];
    board = await repository.deleteColumnInRepository(
      board,
      added.id,
      board.columns[0].id,
    );
    expect(board.tasks[0].columnId).toBe(board.columns[0].id);
    expect(board.allowedTransitions).toEqual([
      {
        fromColumnId: board.columns[0].id,
        toColumnId: board.columns[1].id,
      },
    ]);
    board = await repository.setTransitionRulesInRepository(board, true, [
      { fromColumnId: board.columns[0].id, toColumnId: board.columns[1].id },
    ]);
    board = await repository.addCustomFieldInRepository(
      board,
      "Score",
      "number",
      true,
    );
    board = await repository.setCustomValueInRepository(
      board,
      board.tasks[0].id,
      board.customFields[0].id,
      { kind: "number", value: 4 },
    );
    expect(board.tasks[0].customValues[board.customFields[0].id]).toEqual({
      kind: "number",
      value: 4,
    });
    await repository.setSecret("ignored", "web");
  });

  it("stores actions, sources, settings, archives and web previews", async () => {
    const board = boardWithTasks();
    await repository.persistBoard(board);
    const action = repository.newCommandAction("Local action");
    await repository.saveActionInRepository(action);
    await repository.saveActionInRepository({ ...action, script: "updated" });
    expect(await repository.loadActions()).toEqual([
      expect.objectContaining({ script: "updated" }),
    ]);
    expect((await repository.previewAutomationDraft("draft"))[0]).toEqual(
      expect.objectContaining({ actionName: "Local action" }),
    );
    localStorage.setItem("workonit.actions", "bad");
    expect(await repository.loadActions()).toEqual([]);

    const source = repository.newSource();
    expect(repository.newSource().initialColumnId).toBe("");
    await repository.saveSourceInRepository(source);
    await repository.saveSourceInRepository({ ...source, name: "Updated" });
    expect(await repository.loadSources()).toHaveLength(1);
    const legacySource = { ...source } as Partial<typeof source>;
    delete legacySource.customFieldMapping;
    delete legacySource.allowedUpdateCustomFields;
    localStorage.setItem("workonit.sources", JSON.stringify([legacySource]));
    expect((await repository.loadSources())[0]).toEqual(
      expect.objectContaining({
        customFieldMapping: {},
        allowedUpdateCustomFields: [],
      }),
    );
    expect(await repository.loadTriggers(source.id)).toEqual([]);
    await repository.saveTriggerInRepository({
      id: "trigger",
      sourceId: source.id,
      enabled: true,
      catchUpLast: false,
    });
    expect(await repository.loadAutomationDrafts(board.id)).toEqual([]);

    const json = await repository.previewSourceInRepository(
      "json",
      '[{"title":"A","description":"D","id":"1"},{"no":"title"}]',
      { title: "$.title" },
    );
    expect(json.records).toHaveLength(1);
    expect(json.errors).toHaveLength(1);
    const jsonl = await repository.previewSourceInRepository(
      "jsonl",
      '{"title":"No key"}\ninvalid\n',
      { title: "$.title" },
    );
    expect(jsonl.warnings).toEqual(["Clé externe absente"]);
    expect(jsonl.errors).toHaveLength(1);
    const text = await repository.previewSourceInRepository(
      "text",
      "A: desc\nnope",
      { title: "title" },
      "^(?<title>[^:]+): (?<description>.*)$",
    );
    expect(text.records[0].description).toBe("desc");
    expect(text.errors).toHaveLength(1);
    expect(
      (
        await repository.previewSourceInRepository("text", "x", {
          title: "title",
        })
      ).errors,
    ).toHaveLength(1);
    expect(
      (
        await repository.previewSourceInRepository(
          "text",
          "x",
          { title: "title" },
          "[",
        )
      ).errors,
    ).toHaveLength(1);

    expect(await repository.loadExecutions()).toEqual([]);
    await repository.resumeExecutionInRepository("board", "execution", false);
    await repository.abandonExecutionInRepository("board", "execution");
    expect(await repository.listBackups()).toEqual([]);
    expect(await repository.createBackup()).toBeNull();
    expect(await repository.takePendingImports()).toEqual([]);
    await repository.setSetting("notifications.success", "true");
    expect(await repository.getSetting("notifications.success")).toBe("true");
    expect(await repository.getSetting("logs.retention_days")).toBeUndefined();

    let archived = await repository.archiveTaskInRepository(
      board,
      board.tasks[0].id,
    );
    archived = await repository.restoreTaskInRepository(
      archived.id,
      archived.tasks[0].id,
    );
    expect(archived.tasks[0].archived).toBe(false);
    archived = await repository.deleteTaskPermanently(
      archived.id,
      archived.tasks[0].id,
    );
    expect(archived.tasks).toHaveLength(1);
    await repository.persistBoard({ ...archived, sourceIds: [source.id] });
    await repository.deleteSourceInRepository(source.id);
    expect(await repository.loadSources()).toEqual([]);
    expect(repository.initialBoards()[0].sourceIds).toEqual([]);
    await expect(
      repository.restoreTaskInRepository("missing", "task"),
    ).rejects.toThrow("Kanban introuvable");
    await expect(
      repository.deleteTaskPermanently("missing", "task"),
    ).rejects.toThrow("Kanban introuvable");
  });
});

describe("repository desktop adapter", () => {
  beforeEach(() => {
    localStorage.clear();
    desktop(true);
    invoke.mockReset();
  });

  it("maps every desktop operation to a Tauri command", async () => {
    const board = boardWithTasks();
    const action = repository.newCommandAction("Desktop");
    const source = repository.newSource();
    const preview: SourcePreview = { records: [], errors: [], warnings: [] };
    const draft: AutomationDraft = {
      automationId: "auto",
      boardId: board.id,
      draft: {
        id: "auto",
        boardId: board.id,
        name: "Auto",
        toColumnId: board.columns[1].id,
        origins: ["user"],
        steps: [],
        requireConfirmation: false,
        enabled: false,
      },
      revision: 1,
      lastTestSucceeded: false,
    };
    invoke.mockImplementation(async (command: string) => {
      if (command === "list_boards") return [board];
      if (command === "get_setting") return null;
      if (command.startsWith("create_backup"))
        return { path: "b", name: "b", bytes: 1 };
      if (
        command.includes("board") ||
        command.includes("task") ||
        command.includes("column") ||
        command === "set_transition_rules" ||
        command === "set_custom_value" ||
        command === "apply_source_result" ||
        command === "restore_backup"
      )
        return command === "restore_backup" ? [board] : board;
      if (command === "list_actions") return [action];
      if (command === "list_all_sources") return [source];
      if (command === "preview_source") return preview;
      if (command === "list_automation_drafts") return [draft];
      if (command === "preview_automation_draft") return [];
      if (
        command === "list_executions" ||
        command === "list_triggers" ||
        command === "list_backups" ||
        command === "take_pending_imports"
      )
        return [];
      if (command === "inspect_source_now")
        return { preview, output: { truncated: false, encodingErrors: false } };
      if (command === "run_source_now") return { preview };
      if (command === "test_automation_draft") return { status: "succeeded" };
      if (command === "preview_import_file")
        return { manifest: {}, bundle: {} };
      if (command === "preview_import_conflicts") return [];
      if (command === "apply_import_file") return { boards: [board] };
      return undefined;
    });

    expect(repository.isDesktopRuntime()).toBe(true);
    expect(await repository.loadBoards()).toEqual([board]);
    await repository.persistBoard(board);
    await repository.createBoardInRepository("Desktop");
    await repository.addTaskInRepository(board, board.columns[0].id, "x");
    await repository.updateTaskInRepository(board, board.tasks[0]);
    await repository.reorderTaskInRepository(board, board.tasks[0].id, 0);
    await repository.archiveTaskInRepository(board, board.tasks[0].id);
    await repository.addColumnInRepository(board, "x");
    await repository.configureColumnInRepository(
      board,
      board.columns[0].id,
      "x",
      "#0",
      { kind: "none" },
    );
    await repository.deleteColumnInRepository(
      board,
      board.columns[2].id,
      board.columns[0].id,
    );
    await repository.setTransitionRulesInRepository(board, true, []);
    await repository.addCustomFieldInRepository(board, "x", "text", false);
    await repository.setCustomValueInRepository(board, board.tasks[0].id, "f", {
      kind: "text",
      value: "v",
    });
    await repository.setSecret("secret", "value");
    await repository.moveTaskOnBackend(
      board.id,
      board.tasks[0].id,
      board.columns[1].id,
      true,
    );
    expect(await repository.loadActions()).toEqual([action]);
    await repository.saveActionInRepository(action);
    expect(await repository.loadSources()).toEqual([source]);
    await repository.saveSourceInRepository(source);
    await repository.runSourceNow(source.id, true, true);
    await repository.inspectSourceNow(source.id);
    await repository.applySourceResult(source.id, preview);
    await repository.cancelSourceExecution(source.id);
    await repository.loadTriggers(source.id);
    await repository.saveTriggerInRepository({
      id: "t",
      sourceId: source.id,
      enabled: true,
      catchUpLast: true,
    });
    await repository.previewSourceInRepository("json", "[]", source.mapping);
    await repository.loadAutomationDrafts(board.id);
    await repository.saveAutomationDraftInRepository(draft);
    await repository.previewAutomationDraft(draft.automationId);
    await repository.testAutomationDraft(draft.automationId, board.tasks[0].id);
    await repository.activateAutomationDraft(draft.automationId);
    await repository.loadExecutions();
    await repository.loadSchedulerJournal();
    await repository.resumeExecutionInRepository(board.id, "execution", true);
    await repository.abandonExecutionInRepository(board.id, "execution");
    await repository.cancelTaskExecution(board.tasks[0].id);
    await repository.restoreTaskInRepository(board.id, board.tasks[0].id);
    await repository.deleteTaskPermanently(board.id, board.tasks[0].id);
    await repository.listBackups();
    await repository.createBackup();
    await repository.restoreBackup("b");
    expect(await repository.getSetting("logs.retention_days")).toBeUndefined();
    await repository.setSetting("notifications.success", "true");
    await repository.previewImportFile("f");
    await repository.previewImportConflicts("f");
    await repository.applyImportFile("f", []);
    await repository.trustImportedCommands(["a"], ["s"]);
    await repository.writeExportFile("f", true, {
      boardIds: [board.id],
      includeActions: true,
      includeSources: false,
      includeTriggers: false,
    });
    await repository.takePendingImports();
    await repository.deleteSourceInRepository(source.id);
    expect(invoke).toHaveBeenCalledWith("delete_source", {
      sourceId: source.id,
    });
    expect(invoke).toHaveBeenCalledWith(
      "move_task",
      expect.objectContaining({ confirmed: true }),
    );
  });

  it("falls back to the local cache when desktop board loading fails", async () => {
    const board = boardWithTasks();
    localStorage.setItem("workonit.boards", JSON.stringify([board]));
    invoke.mockRejectedValueOnce(new Error("offline"));
    expect(await repository.loadBoards()).toEqual([board]);
  });

  it("selects the Windows guided runner", () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Windows",
    });
    expect(repository.newCommandAction().runner).toBe("powershell");
    expect(repository.shellRunnerOptions()).toEqual([
      "powershell",
      "pwsh",
      "cmd.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
    ]);
    if (descriptor) Object.defineProperty(navigator, "userAgent", descriptor);
    else delete (navigator as { userAgent?: string }).userAgent;
  });

  it("reuses the last selected runner for a new action", () => {
    repository.rememberCommandRunner("/opt/homebrew/bin/fish");
    expect(repository.newCommandAction().runner).toBe(
      "/opt/homebrew/bin/fish",
    );
  });

  it("offers all three macOS shells", () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Macintosh",
    });
    expect(repository.shellRunnerOptions()).toEqual([
      "/bin/zsh",
      "/bin/bash",
      "/bin/sh",
    ]);
    if (descriptor) Object.defineProperty(navigator, "userAgent", descriptor);
    else delete (navigator as { userAgent?: string }).userAgent;
  });
});
