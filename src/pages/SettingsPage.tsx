import { useEffect, useState } from "react";
import { copy } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { LifecycleSection } from "../components/settings/LifecycleSection";
import { NotificationsSection } from "../components/settings/NotificationsSection";
import { LogsSection } from "../components/settings/LogsSection";
import {
  ExportImportSection,
  type ExportOptions,
} from "../components/settings/ExportImportSection";
import {
  ImportPreviewPanel,
  type ConflictDecision,
} from "../components/settings/ImportPreviewPanel";
import { BackupsSection } from "../components/settings/BackupsSection";
import { RestoreBackupConfirm } from "../components/settings/RestoreBackupConfirm";
import {
  applyImportFile,
  createBackup,
  listBackups,
  previewImportConflicts,
  previewImportFile,
  restoreBackup,
  trustImportedCommands,
  writeExportFile,
} from "../lib/repository";
import { type Board } from "../lib/types";
import type {
  BackupInfo,
  ImportConflict,
  ImportResult,
} from "../lib/backend-types";

export function SettingsPage({
  boards,
  pendingImportPath,
  onBoards,
  onMessage,
}: {
  boards: Board[];
  pendingImportPath: string | null;
  onBoards: (boards: Board[]) => void;
  onMessage: (message: string) => void;
}) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupInfo | null>(
    null,
  );
  const [importPath, setImportPath] = useState<string | null>(
    pendingImportPath,
  );
  const [importPreview, setImportPreview] = useState<ImportResult | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ConflictDecision>>(
    {},
  );
  const [trust, setTrust] = useState(false);

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
  const exportData = async (options: ExportOptions) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      defaultPath: "workonit-export.workonit",
      filters: [{ name: "WorkOnIt", extensions: ["workonit"] }],
    });
    if (selected) {
      await writeExportFile(selected, options.includeHistory, {
        boardIds: options.boardIds,
        includeActions: options.includeActions,
        includeSources: options.includeSources,
        includeTriggers: options.includeTriggers,
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

  return (
    <>
      <PageHeader title={copy("c006")} description={copy("c221")} />
      <section className="content-page settings-page" aria-label={copy("c220")}>
        <div className="settings-grid">
          <LifecycleSection />
          <NotificationsSection />
          <LogsSection />
          <ExportImportSection
            boards={boards}
            onExport={(options) => void exportData(options)}
            onChooseImport={() => void chooseImport()}
          >
            {importPreview && (
              <ImportPreviewPanel
                preview={importPreview}
                conflicts={conflicts}
                decisions={decisions}
                trust={trust}
                boards={boards}
                onDecision={(key, decision) =>
                  setDecisions((current) => ({ ...current, [key]: decision }))
                }
                onTrust={setTrust}
                onApply={() => void applyImport()}
              />
            )}
          </ExportImportSection>
          <BackupsSection
            backups={backups}
            onCreate={() =>
              void createBackup().then(async () =>
                setBackups(await listBackups()),
              )
            }
            onRestoreRequest={setRestoreCandidate}
          />
        </div>
        {restoreCandidate && (
          <RestoreBackupConfirm
            backup={restoreCandidate}
            onCancel={() => setRestoreCandidate(null)}
            onConfirm={() =>
              void restoreBackup(restoreCandidate.path).then((updated) => {
                onBoards(updated);
                setRestoreCandidate(null);
                onMessage(copy("c297"));
              })
            }
          />
        )}
      </section>
    </>
  );
}
