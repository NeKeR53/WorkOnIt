import type { Board, ExecutionStatus, Task } from "./types";

export interface CommandAction {
  id: string;
  name: string;
  script: string;
  runner: string;
  workingDirectory?: string;
  loadProfile: boolean;
  timeoutSeconds?: number;
  acceptedExitCodes: number[];
  stopOnFailure: boolean;
  destructive: boolean;
  enabled: boolean;
  variants: Array<{
    operatingSystem: "windows" | "macOs";
    runner: string;
    script: string;
  }>;
  stdoutValidation?: { kind: "regex" | "jsonPath"; expression: string };
  secretNames: string[];
  directExecution: boolean;
  arguments: string[];
  outputLimitBytes: number;
}

export interface ActionStep {
  actionId: string;
  stopOnFailure: boolean;
  condition?: ActionCondition;
}

export type ActionCondition =
  | { kind: "fieldEquals"; field: string; value: string }
  | { kind: "fieldContains"; field: string; value: string }
  | { kind: "origin"; origin: "user" | "source" | "plugin" | "system" }
  | { kind: "operatingSystem"; name: string };

export interface TransitionAutomation {
  id: string;
  boardId: string;
  name: string;
  fromColumnId?: string;
  toColumnId: string;
  origins: Array<"user" | "source" | "plugin" | "system">;
  steps: ActionStep[];
  requireConfirmation: boolean;
  enabled: boolean;
  notifications?: {
    success?: boolean;
    failure?: boolean;
    confirmation?: boolean;
    sourceBlocked?: boolean;
  };
}

export interface AutomationDraft {
  automationId: string;
  boardId: string;
  draft: TransitionAutomation;
  active?: TransitionAutomation;
  revision: number;
  testedAt?: string;
  lastTestSucceeded: boolean;
}

export type SourceFormat = "json" | "jsonl" | "text";
export interface SourceDefinition {
  id: string;
  boardId: string;
  name: string;
  command: CommandAction;
  format: SourceFormat;
  mapping: {
    title: string;
    description?: string;
    externalKey?: string;
    column?: string;
  };
  customFieldMapping: Record<string, string>;
  allowedUpdateCustomFields: string[];
  textPattern?: string;
  initialColumnId: string;
  columnMapping: Record<string, string>;
  fallbackColumnId?: string;
  allowedUpdateFields: Array<"title" | "description">;
  moveExistingTasks: boolean;
  acceptPartial: boolean;
  absenceThreshold: number;
  outputLimitBytes: number;
  encoding: "utf8" | "windows1252" | "system" | "auto";
  enabled: boolean;
}

export type ScheduleSpec =
  | { kind: "interval"; seconds: number }
  | { kind: "daily"; hour: number; minute: number; timezone: string }
  | {
      kind: "weekly";
      weekdays: number[];
      hour: number;
      minute: number;
      timezone: string;
    }
  | { kind: "cron"; expression: string; timezone: string };

export interface TriggerDefinition {
  id: string;
  sourceId: string;
  schedule?: ScheduleSpec;
  enabled: boolean;
  catchUpLast: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface SourcePreview {
  records: Array<{
    title: string;
    description: string;
    externalKey?: string;
    sourceLine: number;
    columnValue?: string;
    customValues?: Record<string, string>;
  }>;
  errors: Array<{ line: number; message: string }>;
  warnings: string[];
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  automationIds: string[];
  status: ExecutionStatus;
  steps: Array<{
    actionId: string;
    actionName: string;
    status:
      | "succeeded"
      | "failed"
      | "timedOut"
      | "skipped"
      | "cancelled"
      | "incompatible";
    exitCode?: number;
    stdout: string;
    stderr: string;
    startedAt: string;
    finishedAt: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }>;
  startedAt: string;
  finishedAt?: string;
  failedStep?: number;
}

export interface SchedulerJournalEntry {
  id: string;
  sourceId: string;
  kind: "missed" | "alreadyActive";
  occurredAt: string;
}

export interface BackupInfo {
  path: string;
  name: string;
  bytes: number;
}

export interface ImportResult {
  manifest: { formatVersion: number; exportedAt: string; product: string };
  bundle: {
    boards: Board[];
    actions: CommandAction[];
    automations: TransitionAutomation[];
    sources: SourceDefinition[];
    triggers: unknown[];
  };
  trustRequiredActions: string[];
  trustRequiredSources: string[];
}

export interface ImportConflict {
  id: string;
  name: string;
  kind: "board" | "action" | "automation" | "source" | "trigger";
}

export interface CommandPreview {
  actionId: string;
  actionName: string;
  runner: string;
  script: string;
  workingDirectory?: string;
  environmentVariables: string[];
  secretNames: string[];
}

export type { Board, Task };
