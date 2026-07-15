export type WipPolicy =
  | { kind: "none" }
  | { kind: "warning"; limit: number }
  | { kind: "hard"; limit: number };

export type ExecutionStatus =
  | "idle"
  | "pending"
  | "failed"
  | "succeeded"
  | "cancelled"
  | "interrupted"
  | { running: { step: number; total: number } };

export interface Column {
  id: string;
  name: string;
  color: string;
  position: number;
  wipPolicy: WipPolicy;
}

export interface TransitionRecord {
  fromColumnId: string;
  toColumnId: string;
  origin: "user" | "source" | "plugin" | "system";
  occurredAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  columnId: string;
  position: number;
  tags: string[];
  notes: string;
  priority?: "Basse" | "Normale" | "Haute";
  dueDate?: string;
  sourceName?: string;
  externalKey?: string;
  customValues: Record<string, unknown>;
  executionStatus: ExecutionStatus;
  history: TransitionRecord[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  name: string;
  columns: Column[];
  tasks: Task[];
  customFields: Array<{
    id: string;
    name: string;
    kind: string;
    pinned: boolean;
  }>;
  transitionsRestricted: boolean;
  allowedTransitions: Array<{ fromColumnId: string; toColumnId: string }>;
  createdAt: string;
  updatedAt: string;
}

export type Page = "boards" | "sources" | "automations" | "history";

const id = () => crypto.randomUUID();

export function createBoard(name: string): Board {
  const now = new Date().toISOString();
  const columns: Column[] = [
    { id: id(), name: "À faire", color: "#65558f", position: 0, wipPolicy: { kind: "none" } },
    { id: id(), name: "En cours", color: "#006a6a", position: 1, wipPolicy: { kind: "warning", limit: 5 } },
    { id: id(), name: "Terminé", color: "#4f6354", position: 2, wipPolicy: { kind: "none" } },
  ];
  return {
    id: id(),
    name: name.trim(),
    columns,
    tasks: [],
    customFields: [],
    transitionsRestricted: false,
    allowedTransitions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createTask(title: string, columnId: string, position: number): Task {
  const now = new Date().toISOString();
  return {
    id: id(),
    title: title.trim(),
    description: "",
    columnId,
    position,
    tags: [],
    notes: "",
    customValues: {},
    executionStatus: "idle",
    history: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}
