import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { createBoard } from "../../lib/types";

const mocks = vi.hoisted(() => ({
  loadSources: vi.fn(),
  persistBoard: vi.fn(),
}));

vi.mock("../../lib/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/repository")>()),
  ...mocks,
}));

import { newSource } from "../../lib/repository";
import { BoardSourcesSection } from "./BoardSourcesSection";

describe("BoardSourcesSection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("fr");
    mocks.persistBoard.mockResolvedValue(undefined);
  });

  it("shows the empty state and saves an empty association", async () => {
    mocks.loadSources.mockResolvedValue([]);
    const board = createBoard("Board");
    delete (board as Partial<typeof board>).sourceIds;
    const onBoard = vi.fn();
    const onMessage = vi.fn();
    const user = userEvent.setup();

    render(
      <BoardSourcesSection
        board={board}
        onBoard={onBoard}
        onMessage={onMessage}
      />,
    );

    expect(await screen.findByText("Aucune source créée.")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Enregistrer les sources" }),
    );
    expect(onBoard).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [] }),
    );
    expect(mocks.persistBoard).toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith("Sources du kanban enregistrées");
  });

  it("adds and removes source associations", async () => {
    const first = { ...newSource(), id: "first", name: "First source" };
    const second = { ...newSource(), id: "second", name: "Second source" };
    mocks.loadSources.mockResolvedValue([first, second]);
    const board = { ...createBoard("Board"), sourceIds: [first.id] };
    const onBoard = vi.fn();
    const user = userEvent.setup();

    render(
      <BoardSourcesSection
        board={board}
        onBoard={onBoard}
        onMessage={vi.fn()}
      />,
    );

    const firstCheckbox = await screen.findByRole("checkbox", {
      name: first.name,
    });
    const secondCheckbox = screen.getByRole("checkbox", { name: second.name });
    expect(firstCheckbox).toBeChecked();
    expect(secondCheckbox).not.toBeChecked();
    await user.click(firstCheckbox);
    await user.click(secondCheckbox);
    await user.click(
      screen.getByRole("button", { name: "Enregistrer les sources" }),
    );

    expect(onBoard).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [second.id] }),
    );
  });
});
