import { useEffect, useState } from "react";
import { copy } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ActionGrid } from "../components/automations/ActionGrid";
import { ConditionFields } from "../components/automations/ConditionFields";
import { CommandTab } from "../components/automations/CommandTab";
import { ContextTab } from "../components/automations/ContextTab";
import { NotificationsFieldset } from "../components/automations/NotificationsFieldset";
import { ActionChainEditor } from "../components/automations/ActionChainEditor";
import { TestTab } from "../components/automations/TestTab";
import {
  activateAutomationDraft,
  isDesktopRuntime,
  loadActions,
  loadAutomationDrafts,
  newCommandAction,
  previewAutomationDraft,
  saveActionInRepository,
  saveAutomationDraftInRepository,
  shellRunnerOptions,
  testAutomationDraft,
} from "../lib/repository";
import { type Board } from "../lib/types";
import type {
  ActionCondition,
  ActionStep,
  AutomationDraft,
  CommandAction,
  CommandPreview,
  TransitionAutomation,
} from "../lib/backend-types";

export function AutomationsPage({
  board,
  onMessage,
}: {
  board: Board;
  onMessage: (message: string) => void;
}) {
  const [tab, setTab] = useState("Commande");
  const [editorOpen, setEditorOpen] = useState(false);
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
  const runnerOptions = shellRunnerOptions();
  const availableRunnerOptions =
    action.runner && !runnerOptions.includes(action.runner)
      ? [action.runner, ...runnerOptions]
      : runnerOptions;
  const openAction = (selectedAction: CommandAction) => {
    setAction(selectedAction);
    setTab("Commande");
    setEditorOpen(true);
  };
  const createAction = () => {
    openAction(newCommandAction());
  };
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
    <>
      <PageHeader
        title={copy("c123")}
        description={editorOpen ? copy("c362") : copy("c124")}
        actions={
          editorOpen ? (
            <button
              className="secondary-button"
              onClick={() => setEditorOpen(false)}
            >
              <Icon name="arrow_back" />
              {copy("c363")}
            </button>
          ) : (
            <button className="primary-button" onClick={createAction}>
              <Icon name="add" />
              {copy("c125")}
            </button>
          )
        }
      />
      <section className="content-page">
        {!editorOpen ? (
          <ActionGrid
            actions={actions}
            onOpen={openAction}
            onCreate={createAction}
          />
        ) : (
          <div className="automation-editor-layout">
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
                  <ConditionFields
                    condition={condition}
                    board={board}
                    onChange={updateCondition}
                  />
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
                <CommandTab
                  action={action}
                  runnerOptions={availableRunnerOptions}
                  onChange={setAction}
                />
              ) : tab === "Contexte" ? (
                <ContextTab action={action} onChange={setAction} />
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
                  <NotificationsFieldset
                    value={automationNotifications}
                    onChange={setAutomationNotifications}
                  />
                  <ActionChainEditor
                    steps={draftSteps}
                    actions={actions}
                    selectedIndex={selectedStepIndex}
                    onAdd={() => {
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
                    onSelect={selectStep}
                    onToggleStop={(index, stopOnFailure) =>
                      setDraftSteps((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, stopOnFailure }
                            : item,
                        ),
                      )
                    }
                    onMove={(index, direction) =>
                      setDraftSteps((current) => {
                        const next = [...current];
                        [next[index + direction], next[index]] = [
                          next[index],
                          next[index + direction],
                        ];
                        setSelectedStepIndex(index + direction);
                        return next;
                      })
                    }
                    onRemove={(index) => {
                      setDraftSteps((current) =>
                        current.filter(
                          (_item, itemIndex) => itemIndex !== index,
                        ),
                      );
                      setSelectedStepIndex(0);
                    }}
                  />
                </div>
              ) : (
                <TestTab
                  preview={preview}
                  onPreview={() => void showPreview()}
                  onRequestTest={() => setConfirmTest(true)}
                />
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
        )}
        {confirmTest && (
          <ConfirmDialog
            nested
            ariaLabel={copy("c163")}
            title={copy("c164")}
            description={copy("c165")}
            confirmLabel={copy("c166")}
            onCancel={() => setConfirmTest(false)}
            onConfirm={() => void executeTest()}
          />
        )}
      </section>
    </>
  );
}
