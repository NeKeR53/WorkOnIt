import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";

describe("WorkOnIt main flow", () => {
  beforeEach(() => localStorage.clear());

  it("creates the first board, adds a task, and moves it without drag and drop", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: "Organisez le travail à votre façon" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Créer un kanban" }));
    await user.type(screen.getByLabelText("Nom du kanban"), "Produit");
    await user.click(screen.getByRole("button", { name: "Créer le kanban" }));

    expect(await screen.findByRole("heading", { name: "Produit" })).toBeVisible();
    const todo = screen.getByRole("region", { name: "À faire" });
    await user.click(within(todo).getByRole("button", { name: "Ajouter une tâche dans À faire" }));
    await user.type(screen.getByLabelText("Titre"), "Préparer la version");
    await user.click(screen.getByRole("button", { name: "Ajouter la tâche" }));

    await user.click(screen.getByRole("button", { name: "Préparer la version" }));
    await user.click(screen.getByRole("button", { name: "Déplacer vers…" }));
    await user.click(screen.getByRole("menuitem", { name: "En cours" }));

    expect(within(screen.getByRole("region", { name: "En cours" })).getByText("Préparer la version")).toBeVisible();
  });

  it("previews valid JSON source records", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Sources" }));
    await user.click(screen.getByRole("button", { name: "Prévisualiser" }));

    expect(screen.getByText("Exemple à importer")).toBeVisible();
    expect(screen.getByRole("button", { name: "Importer 1 tâche(s)" })).toBeVisible();
  });
});
