import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBoard, createTask, type Board } from "./lib/types";
import type {
  AutomationDraft,
  BackupInfo,
  CommandAction,
  ExecutionRecord,
  ImportResult,
  SourceDefinition,
} from "./lib/backend-types";
import i18n from "./i18n";

const mocks = vi.hoisted(() => ({
  listen: vi.fn<
    (
      event: string,
      callback: (event: { payload: unknown }) => void,
    ) => Promise<() => void>
  >(async () => vi.fn()),
  loadBoards: vi.fn(),
  takePendingImports: vi.fn(),
  moveTaskOnBackend: vi.fn(),
  cancelTaskExecution: vi.fn(),
  cancelSourceExecution: vi.fn(),
  loadActions: vi.fn(),
  loadAutomationDrafts: vi.fn(),
  loadExecutions: vi.fn(),
  loadSchedulerJournal: vi.fn(),
  resumeExecutionInRepository: vi.fn(),
  abandonExecutionInRepository: vi.fn(),
  loadSources: vi.fn(),
  loadTriggers: vi.fn(),
  inspectSourceNow: vi.fn(),
  applySourceResult: vi.fn(),
  saveSourceInRepository: vi.fn(),
  saveTriggerInRepository: vi.fn(),
  saveActionInRepository: vi.fn(),
  saveAutomationDraftInRepository: vi.fn(),
  previewAutomationDraft: vi.fn(),
  testAutomationDraft: vi.fn(),
  activateAutomationDraft: vi.fn(),
  listBackups: vi.fn(),
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  previewImportFile: vi.fn(),
  previewImportConflicts: vi.fn(),
  applyImportFile: vi.fn(),
  trustImportedCommands: vi.fn(),
  writeExportFile: vi.fn(),
}));

vi.mock("./lib/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/repository")>()),
  isDesktopRuntime: () => true,
  ...mocks,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
const open = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, save }));
const enable = vi.fn();
const disable = vi.fn();
const isEnabled = vi.fn();
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable,
  disable,
  isEnabled,
}));

import App from "./App";

function desktopBoard(): Board {
  const board = createBoard("Desktop board");
  const first = createTask("Desktop task", board.columns[0].id, 0);
  const second = createTask("Running task", board.columns[0].id, 1);
  second.executionStatus = { running: { step: 1, total: 2 } };
  board.tasks = [first, second];
  return board;
}

function action(): CommandAction {
  return {
    id: "action",
    name: "Desktop action",
    script: "echo desktop",
    runner: "/bin/zsh",
    loadProfile: false,
    timeoutSeconds: 300,
    acceptedExitCodes: [0],
    stopOnFailure: true,
    destructive: false,
    enabled: true,
    variants: [],
    secretNames: ["api-token"],
    directExecution: false,
    arguments: [],
    outputLimitBytes: 1024,
  };
}

function source(board: Board): SourceDefinition {
  return {
    id: "source",
    boardId: board.id,
    name: "Desktop source",
    command: { ...action(), secretNames: [] },
    format: "json",
    mapping: { title: "$.title", externalKey: "$.id" },
    customFieldMapping: {},
    allowedUpdateCustomFields: [],
    initialColumnId: board.columns[0].id,
    columnMapping: {},
    allowedUpdateFields: ["title"],
    moveExistingTasks: false,
    acceptPartial: false,
    absenceThreshold: 3,
    outputLimitBytes: 1024,
    encoding: "utf8",
    enabled: true,
  };
}

function execution(
  board: Board,
  status: ExecutionRecord["status"],
): ExecutionRecord {
  return {
    id: `execution-${String(status)}`,
    taskId: board.tasks[0].id,
    automationIds: ["automation"],
    status,
    steps: [
      {
        actionId: "action",
        actionName: "Desktop action",
        status: status === "failed" ? "failed" : "succeeded",
        exitCode: status === "failed" ? 1 : 0,
        stdout: "standard output",
        stderr: "error output",
        startedAt: "2026-07-16T08:00:00Z",
        finishedAt: "2026-07-16T08:00:01Z",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ],
    startedAt: "2026-07-16T08:00:00Z",
    finishedAt: "2026-07-16T08:00:01Z",
  };
}

function configure(board: Board) {
  const nextSource = source(board);
  mocks.loadBoards.mockResolvedValue([board]);
  mocks.takePendingImports.mockResolvedValue([]);
  mocks.loadActions.mockResolvedValue([action()]);
  mocks.loadAutomationDrafts.mockResolvedValue([]);
  mocks.loadExecutions.mockResolvedValue([
    execution(board, "failed"),
    execution(board, { running: { step: 1, total: 2 } }),
    { ...execution(board, "succeeded"), id: "unknown", taskId: "missing" },
    {
      ...execution(board, "interrupted"),
      id: "interrupted",
      taskId: board.tasks[1].id,
    },
  ]);
  mocks.loadSchedulerJournal.mockResolvedValue([]);
  mocks.resumeExecutionInRepository.mockResolvedValue(undefined);
  mocks.abandonExecutionInRepository.mockResolvedValue(undefined);
  mocks.loadSources.mockResolvedValue([nextSource]);
  mocks.loadTriggers.mockResolvedValue([]);
  mocks.inspectSourceNow.mockResolvedValue({
    preview: {
      records: [
        {
          title: "Inspected task",
          description: "",
          externalKey: "1",
          sourceLine: 1,
        },
      ],
      errors: [],
      warnings: [],
    },
    output: { exitCode: 7, truncated: true, encodingErrors: false },
  });
  mocks.applySourceResult.mockResolvedValue(board);
  mocks.cancelTaskExecution.mockResolvedValue(undefined);
  mocks.cancelSourceExecution.mockResolvedValue(undefined);
  mocks.saveSourceInRepository.mockResolvedValue(undefined);
  mocks.saveTriggerInRepository.mockResolvedValue(undefined);
  mocks.saveActionInRepository.mockResolvedValue(undefined);
  mocks.saveAutomationDraftInRepository.mockResolvedValue(undefined);
  mocks.activateAutomationDraft.mockResolvedValue(undefined);
  mocks.setSetting.mockResolvedValue(undefined);
  mocks.trustImportedCommands.mockResolvedValue(undefined);
  mocks.writeExportFile.mockResolvedValue(undefined);
  mocks.previewAutomationDraft.mockResolvedValue([]);
  mocks.testAutomationDraft.mockResolvedValue({ status: "succeeded" });
  mocks.listBackups.mockResolvedValue([]);
  mocks.createBackup.mockResolvedValue(null);
  mocks.restoreBackup.mockResolvedValue([board]);
  mocks.getSetting.mockResolvedValue(undefined);
  mocks.previewImportConflicts.mockResolvedValue([]);
  mocks.applyImportFile.mockResolvedValue({ boards: [board] });
  isEnabled.mockResolvedValue(false);
}

describe("WorkOnIt desktop flows", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("workonit.language", "fr");
    await i18n.changeLanguage("fr");
    vi.clearAllMocks();
  });

  it("loads desktop state, confirms transitions, inspects sources and opens execution logs", async () => {
    const board = desktopBoard();
    configure(board);
    mocks.loadBoards.mockResolvedValue([board, createBoard("Other desktop")]);
    const loadedDraft: AutomationDraft = {
      automationId: "automation",
      boardId: board.id,
      draft: {
        id: "automation",
        boardId: board.id,
        name: "Loaded automation",
        fromColumnId: board.columns[2].id,
        toColumnId: board.columns[0].id,
        origins: ["user"],
        steps: [
          {
            actionId: "action",
            stopOnFailure: true,
            condition: { kind: "origin", origin: "user" },
          },
        ],
        requireConfirmation: false,
        enabled: true,
        notifications: { success: true },
      },
      active: {
        id: "automation",
        boardId: board.id,
        name: "Loaded automation",
        fromColumnId: board.columns[0].id,
        toColumnId: board.columns[1].id,
        origins: ["user"],
        steps: [{ actionId: "action", stopOnFailure: true }],
        requireConfirmation: false,
        enabled: true,
      },
      revision: 2,
      lastTestSucceeded: true,
    };
    mocks.loadAutomationDrafts.mockResolvedValue([loadedDraft]);
    mocks.loadSchedulerJournal.mockResolvedValue([
      {
        id: "missed-source",
        sourceId: "source",
        kind: "missed",
        occurredAt: "2026-07-16T08:00:00Z",
      },
      {
        id: "active-source",
        sourceId: "source",
        kind: "alreadyActive",
        occurredAt: "2026-07-16T08:01:00Z",
      },
    ]);
    mocks.loadTriggers.mockResolvedValue([
      {
        id: "trigger-with-default-schedule",
        sourceId: "source",
        schedule: undefined,
        enabled: false,
        catchUpLast: false,
      },
    ]);
    let resolveInspection!: (value: {
      preview: {
        records: Array<{
          title: string;
          description: string;
          externalKey: string;
          sourceLine: number;
        }>;
        errors: never[];
        warnings: never[];
      };
      output: {
        exitCode: number;
        truncated: boolean;
        encodingErrors: boolean;
      };
    }) => void;
    const pendingInspection = new Promise<
      Parameters<typeof resolveInspection>[0]
    >((resolve) => {
      resolveInspection = resolve;
    });
    mocks.inspectSourceNow
      .mockReturnValueOnce(pendingInspection)
      .mockResolvedValueOnce({
        preview: { records: [], errors: [], warnings: [] },
        output: { exitCode: undefined, truncated: true, encodingErrors: false },
      })
      .mockResolvedValueOnce({
        preview: { records: [], errors: [], warnings: [] },
        output: { exitCode: 0, truncated: false, encodingErrors: false },
      })
      .mockRejectedValueOnce(new Error("inspection failed"))
      .mockRejectedValueOnce(new Error("inspection annulée"));
    mocks.moveTaskOnBackend
      .mockRejectedValueOnce(new Error("confirmation required"))
      .mockRejectedValueOnce(new Error("confirmation required"))
      .mockResolvedValueOnce({
        ...board,
        tasks: board.tasks.map((task) =>
          task.id === board.tasks[0].id
            ? { ...task, columnId: board.columns[1].id }
            : task,
        ),
      })
      .mockRejectedValueOnce(new Error("backend move failed"));
    let progressListener:
      | ((event: {
          payload: { taskId: string; step: number; total: number };
        }) => void)
      | undefined;
    mocks.listen.mockImplementation(async (event, callback) => {
      if (event === "execution-progress")
        progressListener = callback as typeof progressListener;
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: board.name }),
    ).toBeVisible();
    expect(mocks.listen).toHaveBeenCalled();
    progressListener?.({
      payload: { taskId: board.tasks[1].id, step: 2, total: 4 },
    });
    expect(await screen.findByText("En cours 2/4")).toBeVisible();
    const runningCard = screen
      .getByRole("button", { name: "Running task" })
      .closest("article");
    expect(
      fireEvent.dragStart(runningCard!, {
        dataTransfer: { setData: vi.fn() },
      }),
    ).toBe(false);

    await user.click(
      screen.getByRole("button", { name: "Options de À faire" }),
    );
    const columnPanel = screen.getByRole("complementary", {
      name: "Configuration de À faire",
    });
    await user.click(
      within(columnPanel).getByRole("button", {
        name: "Supprimer la colonne…",
      }),
    );
    expect(
      await within(columnPanel).findByText("Loaded automation"),
    ).toBeVisible();
    await user.click(
      within(columnPanel).getByRole("button", { name: "Annuler" }),
    );
    await user.click(
      within(columnPanel).getByRole("button", {
        name: "Fermer la configuration",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Desktop task" }));
    await user.click(screen.getByRole("button", { name: "Déplacer vers…" }));
    await user.click(screen.getByRole("menuitem", { name: "En cours" }));
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Confirmer la transition",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Annuler" }),
    );
    await user.click(screen.getByRole("button", { name: "Déplacer vers…" }));
    await user.click(screen.getByRole("menuitem", { name: "En cours" }));
    const secondConfirmation = await screen.findByRole("alertdialog", {
      name: "Confirmer la transition",
    });
    await user.click(
      within(secondConfirmation).getByRole("button", {
        name: "Confirmer et déplacer",
      }),
    );
    expect(mocks.moveTaskOnBackend).toHaveBeenLastCalledWith(
      board.id,
      board.tasks[0].id,
      board.columns[1].id,
      true,
    );
    await user.click(screen.getByRole("button", { name: "Desktop task" }));
    await user.click(screen.getByRole("button", { name: "Déplacer vers…" }));
    await user.click(screen.getByRole("menuitem", { name: "Terminé" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "backend move failed",
    );
    await user.click(screen.getByRole("button", { name: "Fermer" }));

    await user.click(screen.getByRole("button", { name: "Running task" }));
    await user.click(
      screen.getByRole("button", { name: "Annuler l’exécution" }),
    );
    expect(mocks.cancelTaskExecution).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sources" }));
    await user.click(
      await screen.findByRole("button", { name: "Desktop source JSON" }),
    );
    await screen.findByDisplayValue("Desktop source");
    await user.click(
      screen.getByRole("button", { name: "Exécuter et inspecter" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Arrêter l’exécution active" }),
    );
    expect(mocks.cancelSourceExecution).toHaveBeenCalledWith("source");
    resolveInspection({
      preview: {
        records: [
          {
            title: "Inspected task",
            description: "",
            externalKey: "1",
            sourceLine: 1,
          },
        ],
        errors: [],
        warnings: [],
      },
      output: { exitCode: 7, truncated: true, encodingErrors: false },
    });
    expect(await screen.findByText("Inspected task")).toBeVisible();
    expect(screen.getByText(/Code7.*sortie tronquée/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Exécuter et inspecter" }),
    );
    expect(screen.getByText(/Codeinconnu.*sortie tronquée/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Exécuter et inspecter" }),
    );
    expect(screen.queryByText(/Codeinconnu/)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Exécuter et inspecter" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "inspection failed",
    );
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    await user.click(
      screen.getByRole("button", { name: "Exécuter et inspecter" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Importer cette sortie après validation",
      }),
    );
    expect(mocks.applySourceResult).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Historique" }));
    expect(
      await screen.findByText(
        "Occurrence manquée (rattrapage désactivé) · source",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Exécution ignorée : source déjà active · source"),
    ).toBeVisible();
    const rows = await screen.findAllByRole("button", { name: /Desktop task/ });
    await user.click(rows[0]);
    const detail = screen.getByRole("complementary", {
      name: "Détail de l’exécution",
    });
    expect(within(detail).getByLabelText("Sortie standard")).toHaveTextContent(
      "standard output",
    );
    expect(within(detail).getByLabelText("Sortie erreur")).toHaveTextContent(
      "error output",
    );
    mocks.resumeExecutionInRepository.mockRejectedValueOnce(
      new Error("resume failed"),
    );
    await user.click(
      within(detail).getByRole("button", {
        name: "Relancer depuis l’action échouée",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("resume failed");
    await user.click(
      within(detail).getByRole("button", {
        name: "Relancer depuis l’action échouée",
      }),
    );
    expect(mocks.resumeExecutionInRepository).toHaveBeenCalledWith(
      board.id,
      expect.any(String),
      false,
    );

    const failedRow = (
      await screen.findAllByRole("button", {
        name: /Desktop task/,
      })
    )[0];
    await user.click(failedRow);
    const restartedDetail = screen.getByRole("complementary", {
      name: "Détail de l’exécution",
    });
    await user.click(
      within(restartedDetail).getByRole("button", { name: "Tout relancer" }),
    );
    expect(mocks.resumeExecutionInRepository).toHaveBeenLastCalledWith(
      board.id,
      expect.any(String),
      true,
    );

    const interruptedRow = await screen.findByRole("button", {
      name: /Running task.*interrupted/,
    });
    await user.click(interruptedRow);
    const interruptedDetail = screen.getByRole("complementary", {
      name: "Détail de l’exécution",
    });
    mocks.abandonExecutionInRepository.mockRejectedValueOnce(
      new Error("abandon failed"),
    );
    await user.click(
      within(interruptedDetail).getByRole("button", {
        name: "Abandonner l’exécution",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "abandon failed",
    );
    await user.click(
      within(interruptedDetail).getByRole("button", {
        name: "Abandonner l’exécution",
      }),
    );
    expect(mocks.abandonExecutionInRepository).toHaveBeenCalledWith(
      board.id,
      "interrupted",
    );

    await user.click(
      (await screen.findAllByRole("button", { name: /Desktop task/ }))[0],
    );
    const closableDetail = screen.getByRole("complementary", {
      name: "Détail de l’exécution",
    });
    await user.click(
      within(closableDetail).getByRole("button", {
        name: "Fermer l’exécution",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Automatisations" }));
    await user.click(screen.getByRole("button", { name: /Desktop action/ }));
    await screen.findByDisplayValue("Desktop action");
    expect(screen.getByText(/active \+ brouillon/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Enregistrer brouillon" }),
    );
    await user.click(screen.getByRole("tab", { name: "Test" }));
    await user.click(screen.getByRole("button", { name: "Exécuter le test" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmer et exécuter" }),
    );
    expect(mocks.testAutomationDraft).toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Enregistrer et activer" }),
    );
    expect(mocks.activateAutomationDraft).toHaveBeenCalled();
  });

  it("previews, trusts and applies imports, exports data and restores a backup", async () => {
    const board = desktopBoard();
    configure(board);
    const importedAction = {
      ...action(),
      directExecution: true,
      arguments: ["--safe"],
      variants: [
        {
          operatingSystem: "windows" as const,
          runner: "pwsh",
          script: "Write-Output desktop",
        },
      ],
    };
    const importedSource = source(board);
    const importedBoard: Board = {
      ...board,
      customFields: [
        {
          id: "release-channel",
          name: "Release channel",
          kind: "text",
          pinned: false,
        },
      ],
    };
    const preview: ImportResult = {
      manifest: {
        formatVersion: 1,
        exportedAt: "2026-07-16T08:00:00Z",
        product: "WorkOnIt",
      },
      bundle: {
        boards: [importedBoard],
        actions: [importedAction],
        automations: [],
        sources: [importedSource],
        triggers: [],
      },
      trustRequiredActions: [importedAction.id],
      trustRequiredSources: [importedSource.id],
    };
    mocks.takePendingImports.mockResolvedValue(["pending.workonit"]);
    mocks.previewImportFile.mockResolvedValue(preview);
    mocks.previewImportConflicts.mockResolvedValue([
      { id: board.id, name: board.name, kind: "board" },
    ]);
    const backups: BackupInfo[] = [
      { path: "/backup.sqlite", name: "daily.sqlite", bytes: 2049 },
    ];
    mocks.listBackups.mockResolvedValue(backups);
    mocks.createBackup.mockResolvedValue(backups[0]);
    open.mockResolvedValue("chosen.workonit");
    save.mockResolvedValue("export.workonit");
    const user = userEvent.setup();
    render(<App />);
    const settings = await screen.findByRole("region", {
      name: "Réglages WorkOnIt",
    });
    const importPreview = (
      await within(settings).findByText("Confiance avant import")
    ).closest("div")!;
    expect(importPreview).toBeVisible();
    expect(within(importPreview).getByText(/Variante windows/)).toBeVisible();
    expect(within(importPreview).getByText(/exécutable direct/)).toBeVisible();
    expect(within(importPreview).getByText(/shell/)).toBeVisible();
    expect(
      within(importPreview).getAllByText(/WORKONIT_TITLE.*WORKONIT_COLUMN_ID/s),
    ).toHaveLength(2);
    expect(
      within(importPreview).getAllByText(/WORKONIT_SECRET_API_TOKEN/),
    ).toHaveLength(1);
    expect(
      within(importPreview).getAllByText(/WORKONIT_FIELD_RELEASE_CHANNEL/),
    ).toHaveLength(2);
    await user.selectOptions(
      within(importPreview).getByLabelText(board.name),
      "copy",
    );
    await user.click(
      within(settings).getByLabelText(
        "J’ai vérifié ces commandes et je les active explicitement",
      ),
    );
    await user.click(
      within(settings).getByRole("button", { name: "Appliquer l’import" }),
    );
    expect(mocks.trustImportedCommands).toHaveBeenCalledWith(
      [importedAction.id],
      [importedSource.id],
    );

    await user.click(
      within(settings).getByLabelText("Lancer à l’ouverture de session"),
    );
    expect(enable).toHaveBeenCalled();
    await user.click(
      within(settings).getByLabelText("Lancer à l’ouverture de session"),
    );
    expect(disable).toHaveBeenCalled();
    const exportBoards = within(settings).getByRole("group", {
      name: "Kanbans à exporter",
    });
    await user.click(within(exportBoards).getByLabelText("Desktop board"));
    expect(
      within(settings).getByRole("button", { name: "Exporter" }),
    ).toBeDisabled();
    await user.click(within(exportBoards).getByLabelText("Desktop board"));
    await user.click(
      within(settings).getByLabelText("Actions et automatisations"),
    );
    await user.click(
      within(settings).getByLabelText("Actions et automatisations"),
    );
    await user.click(within(settings).getByLabelText("Sources"));
    expect(
      within(settings).getByLabelText("Déclencheurs des sources"),
    ).toBeDisabled();
    await user.click(within(settings).getByLabelText("Sources"));
    await user.click(
      within(settings).getByLabelText("Déclencheurs des sources"),
    );
    await user.click(
      within(settings).getByRole("button", { name: "Exporter" }),
    );
    expect(mocks.writeExportFile).toHaveBeenCalledWith(
      "export.workonit",
      false,
      {
        boardIds: [board.id],
        includeActions: true,
        includeSources: true,
        includeTriggers: false,
      },
    );
    await user.click(
      within(settings).getByRole("button", { name: "Importer" }),
    );
    expect(open).toHaveBeenCalled();
    await user.click(
      within(settings).getByRole("button", { name: "Créer un snapshot" }),
    );
    await user.click(
      await within(settings).findByRole("button", { name: /daily.sqlite/ }),
    );
    const restore = within(settings).getByRole("alertdialog", {
      name: "Confirmer la restauration",
    });
    await user.click(within(restore).getByRole("button", { name: "Annuler" }));
    await user.click(
      within(settings).getByRole("button", { name: /daily.sqlite/ }),
    );
    await user.click(
      within(settings).getByRole("button", { name: "Restaurer" }),
    );
    expect(mocks.restoreBackup).toHaveBeenCalledWith("/backup.sqlite");
    mocks.restoreBackup.mockResolvedValueOnce([]);
    await user.click(
      within(settings).getByRole("button", { name: /daily.sqlite/ }),
    );
    await user.click(
      within(settings).getByRole("button", { name: "Restaurer" }),
    );
  });

  it("offers a retry after loading failure and handles an import event", async () => {
    const board = desktopBoard();
    configure(board);
    mocks.loadBoards
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([board]);
    let importListener: ((event: { payload: string[] }) => void) | undefined;
    mocks.listen.mockImplementation(async (event, callback) => {
      if (event === "import-file-requested")
        importListener = callback as (event: { payload: string[] }) => void;
      return vi.fn();
    });
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("database unavailable");
    await user.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(
      await screen.findByRole("heading", { name: board.name }),
    ).toBeVisible();
    importListener?.({ payload: ["event.workonit"] });
    expect(
      await screen.findByRole("region", { name: "Réglages WorkOnIt" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kanbans" }));
    importListener?.({ payload: [] });
    unmount();
  });
});
