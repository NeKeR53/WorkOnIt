import { useEffect, useState } from "react";
import { copy } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { ExecutionRow } from "../components/history/ExecutionRow";
import { TransitionEntry } from "../components/history/TransitionEntry";
import { SchedulerEntry } from "../components/history/SchedulerEntry";
import { ExecutionDetail } from "../components/history/ExecutionDetail";
import {
  abandonExecutionInRepository,
  loadBoards,
  loadExecutions,
  loadSchedulerJournal,
  resumeExecutionInRepository,
} from "../lib/repository";
import { type Board } from "../lib/types";
import type {
  ExecutionRecord,
  SchedulerJournalEntry,
} from "../lib/backend-types";

export function HistoryPage({
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
    <>
      <PageHeader title={copy("c168")} description={copy("c169")} />
      <section className="content-page">
        <div className="history-list">
          {executions.map((execution) => (
            <ExecutionRow
              key={execution.id}
              execution={execution}
              taskTitle={
                boards
                  .flatMap((board) => board.tasks)
                  .find((task) => task.id === execution.taskId)?.title
              }
              onSelect={() => setSelected(execution)}
            />
          ))}
          {records.map(({ board, task, history }) => (
            <TransitionEntry
              key={history.occurredAt + task.id}
              board={board}
              task={task}
              history={history}
            />
          ))}
          {schedulerJournal.map((entry) => (
            <SchedulerEntry key={entry.id} entry={entry} />
          ))}
          {!records.length &&
            !executions.length &&
            !schedulerJournal.length && (
              <div className="history-empty">
                <Icon name="history" />
                <h3>{copy("c172")}</h3>
                <p>{copy("c173")}</p>
              </div>
            )}
        </div>
        {selected && (
          <ExecutionDetail
            execution={selected}
            onClose={() => setSelected(null)}
            onRecover={(restartAll) => void recover(restartAll)}
            onAbandon={() => void abandon()}
          />
        )}
      </section>
    </>
  );
}
