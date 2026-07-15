import type { Board } from "./types";

const BOARDS_KEY = "workonit.boards";

function localBoards(): Board[] {
  try {
    return JSON.parse(localStorage.getItem(BOARDS_KEY) ?? "[]") as Board[];
  } catch {
    return [];
  }
}

export function initialBoards(): Board[] {
  return localBoards();
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
  const boards = localBoards();
  const index = boards.findIndex((candidate) => candidate.id === board.id);
  if (index >= 0) boards[index] = board;
  else boards.push(board);
  localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_board", { board });
  }
}
