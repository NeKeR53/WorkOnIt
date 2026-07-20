import { useEffect, useState } from "react";
import { copy } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { SourceList } from "../components/sources/SourceList";
import { SourceToolbar } from "../components/sources/SourceToolbar";
import { CommandAdvancedEditor } from "../components/sources/CommandAdvancedEditor";
import { TriggerEditor } from "../components/sources/TriggerEditor";
import {
  MappingTabs,
  type MappingTab,
} from "../components/sources/MappingTabs";
import { RawPane } from "../components/sources/RawPane";
import { MappingPane } from "../components/sources/MappingPane";
import { PreviewPane } from "../components/sources/PreviewPane";
import {
  applySourceResult,
  cancelSourceExecution,
  deleteSourceInRepository,
  inspectSourceNow,
  isDesktopRuntime,
  loadSources,
  loadTriggers,
  newCommandAction,
  newSource,
  previewSourceInRepository,
  saveSourceInRepository,
  saveTriggerInRepository,
} from "../lib/repository";
import { createTask, type Board, type Task } from "../lib/types";
import type {
  SourceDefinition,
  SourcePreview,
  TriggerDefinition,
} from "../lib/backend-types";

export function SourcesPage({
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
  const [editorOpen, setEditorOpen] = useState(false);
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
  const [mappingTab, setMappingTab] = useState<MappingTab>("raw");
  useEffect(() => {
    void loadSources().then(setSources);
  }, []);
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
    void saveSourceInRepository(updated).then(() => setEditorOpen(false));
  };
  const openSource = (selectedSource: SourceDefinition) => {
    setSource(selectedSource);
    setPreview(null);
    setEditorOpen(true);
  };
  const deleteSource = (item: SourceDefinition) => {
    void deleteSourceInRepository(item.id)
      .then(() => {
        setSources((current) =>
          current.filter((candidate) => candidate.id !== item.id),
        );
        onMessage(copy("c374"));
      })
      .catch((error: unknown) => onMessage(String(error)));
  };
  const inspect = () => {
    setBusy(true);
    void inspectSourceNow(source.id)
      .then((result) => {
        setPreview(result.preview);
        setLastOutput(result.output);
      })
      .catch((error: unknown) => {
        const message = String(error);
        if (!message.toLowerCase().includes("annul")) onMessage(message);
      })
      .finally(() => setBusy(false));
  };
  if (!editorOpen) {
    return (
      <>
        <PageHeader
          title={copy("c059")}
          description={copy("c365")}
          actions={
            <button
              className="primary-button"
              onClick={() => openSource(newSource())}
            >
              <Icon name="add" />
              {copy("c061")}
            </button>
          }
        />
        <section className="content-page">
          <SourceList
            sources={sources}
            onOpen={openSource}
            onDelete={deleteSource}
          />
        </section>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={copy("c059")}
        description={copy("c060")}
        actions={
          <button className="text-button" onClick={() => setEditorOpen(false)}>
            <Icon name="arrow_back" />
            {copy("c367")}
          </button>
        }
      />
      <section className="content-page">
        <SourceToolbar
          source={source}
          busy={busy}
          onChange={setSource}
          onSave={saveSource}
          onInspect={inspect}
          onCancel={() =>
            void cancelSourceExecution(source.id).catch((error: unknown) =>
              onMessage(String(error)),
            )
          }
        />
        <CommandAdvancedEditor
          command={source.command}
          onChange={(command) => setSource({ ...source, command })}
        />
        {trigger && (
          <TriggerEditor
            trigger={trigger}
            onChange={setTrigger}
            onSave={() => void saveTriggerInRepository(trigger)}
          />
        )}
        <MappingTabs value={mappingTab} onChange={setMappingTab} />
        <div className="mapping-grid">
          <RawPane
            raw={raw}
            format={source.format}
            errors={preview?.errors}
            active={mappingTab === "raw"}
            onChange={setRaw}
          />
          <MappingPane
            source={source}
            board={board}
            active={mappingTab === "mapping"}
            onChange={setSource}
            onParse={parse}
            onColumnMappingError={() =>
              setPreview({
                records: [],
                warnings: [],
                errors: [
                  {
                    line: 0,
                    message: "Table de correspondance JSON invalide",
                  },
                ],
              })
            }
          />
          <PreviewPane
            preview={preview}
            lastOutput={lastOutput}
            active={mappingTab === "preview"}
            action={
              preview && !isDesktopRuntime() ? (
                <button className="primary-button" onClick={apply}>
                  {copy("c119")} {preview.records.length} {copy("c120")}
                </button>
              ) : preview && isDesktopRuntime() && source.id !== "preview" ? (
                <button
                  className="primary-button"
                  onClick={() =>
                    void applySourceResult(source.id, preview).then(onBoard)
                  }
                >
                  {copy("c121")}
                </button>
              ) : null
            }
          />
        </div>
      </section>
    </>
  );
}
