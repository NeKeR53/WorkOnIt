import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import i18n from "./i18n";
import { newSource, shellRunnerOptions } from "./lib/repository";
import { createBoard, createTask, type Board } from "./lib/types";

function richBoard(): Board {
  const board = createBoard("Produit");
  board.customFields = [
    { id: "text", name: "Client", kind: "text", pinned: true },
    { id: "number", name: "Score", kind: "number", pinned: true },
    { id: "boolean", name: "Validé", kind: "boolean", pinned: true },
    { id: "date", name: "Livraison", kind: "date", pinned: false },
    { id: "secret", name: "Jeton", kind: "secret", pinned: false },
    {
      id: "list",
      name: "Équipe",
      kind: { list: { options: ["Alpha", "Beta"] } },
      pinned: false,
    },
  ];
  const first = createTask("Alpha task", board.columns[0].id, 0);
  Object.assign(first, {
    description: "Description alpha",
    priority: "Haute",
    dueDate: "2026-07-20",
    tags: ["urgent", "design"],
    notes: "Notes",
    sourceName: "CLI source",
    absentFromSource: true,
    executionStatus: "failed",
    customValues: {
      text: { kind: "text", value: "ACME" },
      number: { kind: "number", value: 5 },
      boolean: { kind: "boolean", value: true },
      date: { kind: "date", value: "2026-07-20" },
      secret: { kind: "secretRef", value: "secret-key" },
      list: { kind: "list", value: "Alpha" },
    },
    history: [
      {
        fromColumnId: board.columns[1].id,
        toColumnId: board.columns[0].id,
        origin: "user",
        occurredAt: "2026-07-16T08:00:00.000Z",
      },
    ],
  });
  const second = createTask("Beta task", board.columns[0].id, 1);
  second.executionStatus = { running: { step: 1, total: 2 } };
  const archived = createTask("Archived task", board.columns[2].id, 0);
  archived.archived = true;
  board.tasks = [first, second, archived];
  return board;
}

function seed(board = richBoard()) {
  localStorage.setItem("workonit.boards", JSON.stringify([board]));
  return board;
}

describe("WorkOnIt main flow", () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("workonit.language", "fr");
    await i18n.changeLanguage("fr");
  });

  it("uses English when the unsaved system language is not French", async () => {
    localStorage.removeItem("workonit.language");
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "en-US",
    });
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Organize work your way",
      }),
    ).toBeVisible();
  });

  it("uses French from an unsaved French system locale and closes dialogs from the backdrop", async () => {
    localStorage.removeItem("workonit.language");
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "fr-FR",
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", {
      name: "Organisez le travail à votre façon",
    });
    await user.click(screen.getByRole("button", { name: "Créer un kanban" }));
    const dialog = screen.getByRole("dialog", { name: "Créer un kanban" });
    fireEvent.mouseDown(within(dialog).getByRole("textbox"));
    expect(dialog).toBeVisible();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(
      screen.queryByRole("dialog", { name: "Créer un kanban" }),
    ).not.toBeInTheDocument();
  });

  it("renders the macOS shortcut hint and filters from the top search", async () => {
    const board = seed();
    const userAgent = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Macintosh");
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: board.name });
    expect(screen.getByText("⌘K")).toBeVisible();
    await user.type(screen.getByPlaceholderText("Rechercher…"), "missing");
    expect(screen.queryByText("Alpha task")).not.toBeInTheDocument();
    unmount();
    userAgent.mockRestore();
  });

  it("creates the first board, adds a task, and moves it without drag and drop", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Organisez le travail à votre façon",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Créer un kanban" }));
    await user.type(screen.getByLabelText("Nom du kanban"), "Produit");
    await user.click(screen.getByRole("button", { name: "Créer le kanban" }));

    expect(
      await screen.findByRole("heading", { name: "Produit" }),
    ).toBeVisible();
    const todo = screen.getByRole("region", { name: "À faire" });
    await user.click(
      within(todo).getByRole("button", {
        name: "Ajouter une tâche dans À faire",
      }),
    );
    await user.type(screen.getByLabelText("Titre"), "Préparer la version");
    await user.click(screen.getByRole("button", { name: "Ajouter la tâche" }));

    await user.click(
      screen.getByRole("button", { name: "Préparer la version" }),
    );
    await user.click(screen.getByRole("button", { name: "Déplacer vers…" }));
    await user.click(screen.getByRole("menuitem", { name: "En cours" }));

    expect(
      within(screen.getByRole("region", { name: "En cours" })).getByText(
        "Préparer la version",
      ),
    ).toBeVisible();
  });

  it("previews valid JSON source records", async () => {
    seed();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Sources" }));
    await user.click(screen.getByRole("button", { name: "Nouvelle source" }));
    await user.click(screen.getByText("Exécution avancée de la source"));
    const advancedSource = screen
      .getByText("Exécution avancée de la source")
      .closest("details")!;
    const sourceRunners = within(advancedSource).getAllByLabelText("Runner");
    await user.clear(sourceRunners[0]);
    await user.type(sourceRunners[0], "/bin/bash");
    const sourceVariantCommands =
      within(advancedSource).getAllByLabelText("Commande");
    await user.type(sourceVariantCommands[0], "echo mac source");
    await user.type(sourceRunners[1], "/bin/zsh");
    await user.type(sourceRunners[2], "pwsh");
    await user.type(sourceVariantCommands[1], "echo windows source");
    await user.type(screen.getByLabelText("Dossier de travail"), "/tmp");
    const sourceTimeout = screen.getAllByLabelText("Timeout (secondes)")[0];
    await user.clear(sourceTimeout);
    await user.type(sourceTimeout, "20");
    await user.clear(screen.getByLabelText("Codes de sortie acceptés"));
    await user.type(
      screen.getByLabelText("Codes de sortie acceptés"),
      "0, 4, nope",
    );
    await user.type(
      screen.getByLabelText("Secrets (noms logiques)"),
      "TOKEN, KEY",
    );
    await user.click(screen.getByLabelText("Charger le profil utilisateur"));
    await user.clear(screen.getByLabelText("Source"));
    await user.type(screen.getByLabelText("Source"), "Edited source");
    await user.type(screen.getAllByLabelText("Commande")[0], "printf data");
    await user.click(screen.getByRole("button", { name: "Prévisualiser" }));

    expect(screen.getByText("Exemple à importer")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Importer 1 tâche(s)" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Importer 1 tâche(s)" }),
    );
  });

  it("deletes a source from the source list", async () => {
    const board = seed();
    const source = newSource();
    source.name = "Source à supprimer";
    board.sourceIds = [source.id];
    localStorage.setItem("workonit.boards", JSON.stringify([board]));
    localStorage.setItem("workonit.sources", JSON.stringify([source]));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Sources" }));
    const deleteButton = screen.getByRole("button", {
      name: "Supprimer la source Source à supprimer",
    });
    await user.click(deleteButton);
    expect(
      screen.queryByRole("button", { name: /Source à supprimer JSON/ }),
    ).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("workonit.boards")!)[0].sourceIds).toEqual(
      [],
    );
  });

  it("blocks forbidden and hard-WIP drag transitions with explanations", async () => {
    const restricted = richBoard();
    restricted.transitionsRestricted = true;
    restricted.allowedTransitions = [];
    seed(restricted);
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: restricted.name });
    fireEvent.drop(screen.getByRole("region", { name: "En cours" }), {
      dataTransfer: { getData: () => restricted.tasks[0].id },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transition vers « En cours » non autorisée",
    );
    unmount();

    localStorage.clear();
    localStorage.setItem("workonit.language", "fr");
    const hard = richBoard();
    hard.columns[1].wipPolicy = { kind: "hard", limit: 1 };
    hard.tasks.push(createTask("Occupant", hard.columns[1].id, 0));
    seed(hard);
    render(<App />);
    await screen.findByRole("heading", { name: hard.name });
    fireEvent.drop(screen.getByRole("region", { name: "En cours" }), {
      dataTransfer: { getData: () => hard.tasks[0].id },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Limite de 1 tâche(s) atteinte dans « En cours »",
    );
  });

  it("covers allowed drops, card states, navigation, palette kinds and focus wrapping", async () => {
    const board = richBoard();
    board.transitionsRestricted = true;
    board.allowedTransitions = [
      {
        fromColumnId: board.columns[0].id,
        toColumnId: board.columns[1].id,
      },
    ];
    board.columns[1].wipPolicy = { kind: "warning", limit: 1 };
    const succeeded = createTask("Succeeded task", board.columns[1].id, 0);
    succeeded.executionStatus = "succeeded";
    succeeded.customValues.boolean = { kind: "boolean", value: false };
    const cancelled = createTask("Cancelled task", board.columns[2].id, 0);
    cancelled.executionStatus = "cancelled";
    board.tasks.push(succeeded, cancelled);
    delete board.tasks[0].customValues.text;
    board.tasks[1].customValues.text = { kind: "text", value: "Beta" };
    const other = createBoard("Other board");
    localStorage.setItem("workonit.boards", JSON.stringify([board, other]));
    localStorage.setItem(
      "workonit.actions",
      JSON.stringify([
        {
          id: "palette-action",
          name: "Palette action",
          script: "",
          runner: "/bin/zsh",
          loadProfile: false,
          timeoutSeconds: 1,
          acceptedExitCodes: [0],
          stopOnFailure: true,
          destructive: false,
          enabled: false,
          variants: [],
          secretNames: [],
          directExecution: false,
          arguments: [],
          outputLimitBytes: 1,
        },
      ]),
    );
    localStorage.setItem(
      "workonit.sources",
      JSON.stringify([
        {
          id: "palette-source",
          boardId: board.id,
          name: "Palette source",
          command: {
            id: "source-command",
            name: "Source",
            script: "",
            runner: "/bin/zsh",
            loadProfile: false,
            timeoutSeconds: 1,
            acceptedExitCodes: [0],
            stopOnFailure: true,
            destructive: false,
            enabled: false,
            variants: [],
            secretNames: [],
            directExecution: false,
            arguments: [],
            outputLimitBytes: 1,
          },
          format: "json",
          mapping: { title: "$.title" },
          initialColumnId: board.columns[0].id,
          columnMapping: {},
          allowedUpdateFields: [],
          moveExistingTasks: false,
          acceptPartial: false,
          absenceThreshold: 1,
          outputLimitBytes: 1,
          encoding: "utf8",
          enabled: false,
        },
      ]),
    );
    const mediaListeners: Array<() => void> = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: (_: string, callback: () => void) =>
          mediaListeners.push(callback),
        removeEventListener: vi.fn(),
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: board.name });
    mediaListeners.forEach((listener) => listener());
    const themeButton = screen.getByRole("button", { name: /^Thème :/ });
    await user.click(themeButton);
    await user.click(themeButton);
    await user.click(screen.getByRole("button", { name: "Other board" }));
    await user.click(screen.getByRole("button", { name: board.name }));
    const firstColumnSort = screen.getByLabelText("Tri visuel — À faire");
    await user.selectOptions(firstColumnSort, "field:text");
    await user.selectOptions(firstColumnSort, "manual");

    const dataTransfer = { setData: vi.fn(), getData: () => board.tasks[0].id };
    fireEvent.dragStart(
      screen.getByRole("button", { name: "Alpha task" }).closest("article")!,
      { dataTransfer },
    );
    expect(dataTransfer.setData).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Alpha task" }));
    await user.click(screen.getByRole("button", { name: "Déplacer vers…" }));
    expect(
      screen.getByRole("menuitem", { name: /Terminé.*non autorisée/ }),
    ).toHaveAttribute("title", "Transition vers Terminé non autorisée");
    await user.click(screen.getByRole("button", { name: "Fermer le détail" }));
    fireEvent.drop(screen.getByRole("region", { name: "En cours" }), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByRole("region", { name: "En cours" }), {
      dataTransfer: { getData: () => "missing-task" },
    });
    fireEvent.dragOver(screen.getByRole("region", { name: "En cours" }));
    await user.click(
      screen.getByRole("button", { name: "Descendre Succeeded task" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Monter Succeeded task" }),
    );

    await user.click(screen.getByRole("button", { name: "Alpha task" }));
    await user.click(
      screen.getByRole("button", {
        name: "Ouvrir directement l’action en échec",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Historique", level: 1 }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kanbans" }));

    await user.click(screen.getByRole("button", { name: "Nouvelle tâche" }));
    const dialog = screen.getByRole("dialog", { name: "Ajouter une tâche" });
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    focusable[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    focusable.at(-1)!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    document.body.tabIndex = -1;
    document.body.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    fireEvent.keyDown(document, { key: "Tab" });
    const emptyDialog = document.createElement("div");
    emptyDialog.setAttribute("role", "dialog");
    emptyDialog.setAttribute("aria-modal", "true");
    document.body.append(emptyDialog);
    await Promise.resolve();
    fireEvent.keyDown(document, { key: "Tab" });
    emptyDialog.remove();

    for (const [query, expected] of [
      ["Palette action", "Automatisations"],
      ["Palette source", "Sources"],
    ]) {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      const palette = screen.getByRole("dialog", { name: "Palette globale" });
      await user.type(within(palette).getByRole("textbox"), query);
      await user.click(
        within(palette).getByRole("button", { name: new RegExp(query) }),
      );
      expect(
        screen.getByRole("button", { name: expected }),
      ).toHaveAttribute("aria-current", "page");
    }
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: "Palette globale" });
    await user.type(within(palette).getByRole("textbox"), "nothing matches");
    expect(within(palette).getByText("Aucun résultat")).toBeVisible();
    await user.click(within(palette).getByRole("button", { name: "Esc" }));
  });

  it("supports chrome, palette, visual sorting and complete task editing", async () => {
    const board = seed();
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Produit" }),
    ).toBeVisible();

    const themeButton = screen.getByRole("button", {
      name: "Thème : Système",
    });
    await user.click(themeButton);
    expect(themeButton).toHaveAccessibleName("Thème : Clair");
    expect(localStorage.getItem("workonit.theme")).toBe("light");
    await user.click(themeButton);
    expect(themeButton).toHaveAccessibleName("Thème : Sombre");
    expect(localStorage.getItem("workonit.theme")).toBe("dark");
    await user.click(themeButton);
    expect(themeButton).toHaveAccessibleName("Thème : Système");
    expect(localStorage.getItem("workonit.theme")).toBe("system");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Langue" }),
      "en",
    );
    expect(screen.getByRole("button", { name: "Boards" })).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Language" }),
      "fr",
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = screen.getByRole("dialog", { name: "Palette globale" });
    await user.type(within(palette).getByRole("textbox"), "Alpha task");
    await user.click(
      within(palette).getByRole("button", { name: /Alpha task/ }),
    );
    expect(
      screen.getByRole("complementary", { name: "Détail de Alpha task" }),
    ).toBeVisible();

    const panel = screen.getByRole("complementary", {
      name: "Détail de Alpha task",
    });
    await user.clear(within(panel).getByLabelText("Titre"));
    await user.type(within(panel).getByLabelText("Titre"), "Alpha edited");
    await user.clear(within(panel).getByLabelText("Description"));
    await user.type(within(panel).getByLabelText("Description"), "Changed");
    await user.selectOptions(within(panel).getByLabelText("Priorité"), "Basse");
    await user.clear(within(panel).getByLabelText("Échéance"));
    await user.type(within(panel).getByLabelText("Échéance"), "2026-08-01");
    await user.clear(within(panel).getByLabelText("Tags"));
    await user.type(within(panel).getByLabelText("Tags"), "one, two");
    await user.clear(within(panel).getByLabelText("Notes"));
    await user.type(within(panel).getByLabelText("Notes"), "new notes");
    await user.clear(within(panel).getByLabelText("Client"));
    await user.type(within(panel).getByLabelText("Client"), "Globex");
    await user.clear(within(panel).getByLabelText("Score"));
    await user.type(within(panel).getByLabelText("Score"), "8");
    await user.click(within(panel).getByLabelText("Validé"));
    await user.clear(within(panel).getByLabelText("Livraison"));
    await user.type(within(panel).getByLabelText("Livraison"), "2026-08-02");
    await user.selectOptions(within(panel).getByLabelText("Équipe"), "Beta");
    await user.type(within(panel).getByLabelText("Jeton"), "top-secret");
    expect(
      within(panel).getByText("Ouvrir directement l’action en échec"),
    ).toBeVisible();
    await user.click(
      within(panel).getByRole("button", { name: "Fermer le détail" }),
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Palette globale" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nouveau kanban" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Créer un kanban" }),
    ).not.toBeInTheDocument();

    const sort = screen.getByLabelText("Tri visuel — À faire");
    expect(screen.getAllByLabelText(/Tri visuel —/)).toHaveLength(3);
    await user.selectOptions(sort, "date");
    await user.selectOptions(sort, "priority");
    await user.selectOptions(sort, "title");
    await user.selectOptions(sort, `field:${board.customFields[0].id}`);
    await user.selectOptions(sort, "manual");
    await user.click(screen.getByRole("button", { name: "Monter Beta task" }));
    expect(
      screen.getByRole("button", { name: "Descendre Beta task" }),
    ).toBeVisible();
  });

  it("sorts priorities when the comparison fallback is on the second task", async () => {
    const board = richBoard();
    board.tasks = [board.tasks[1], board.tasks[0]];
    seed(board);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: board.name });
    await user.selectOptions(
      screen.getByLabelText("Tri visuel — À faire"),
      "priority",
    );
    expect(screen.getByRole("button", { name: "Alpha task" })).toBeVisible();
  });

  it("renders empty custom values and a pinned secret without exposing it", async () => {
    const board = richBoard();
    board.customFields = [
      board.customFields.find((field) => field.id === "secret")!,
      ...board.customFields.filter((field) => field.id !== "secret"),
    ];
    board.customFields[0].pinned = true;
    const empty = createTask("Empty fields", board.columns[0].id, 2);
    board.tasks.push(empty);
    seed(board);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: board.name });
    expect(screen.getByText("Secret configuré")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Empty fields" }));
    const panel = screen.getByRole("complementary", {
      name: "Détail de Empty fields",
    });
    expect(within(panel).getByLabelText("Score")).toHaveValue(null);
    expect(within(panel).getByLabelText("Livraison")).toHaveValue("");
    expect(within(panel).getByLabelText("Jeton")).toHaveAttribute(
      "placeholder",
      "Saisir une fois",
    );
    expect(within(panel).getByLabelText("Équipe")).toHaveValue("");
  });

  it("configures columns, transition rules, custom fields and archive lifecycle", async () => {
    const board = seed();
    board.tasks[1].columnId = board.columns[1].id;
    localStorage.setItem(
      "workonit.boards",
      JSON.stringify([board, createBoard("Archive peer")]),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Produit" });

    await user.click(
      screen.getByRole("button", { name: "Options de À faire" }),
    );
    const columnPanel = screen.getByRole("complementary", {
      name: "Configuration de À faire",
    });
    await user.clear(within(columnPanel).getByLabelText("Nom"));
    await user.type(within(columnPanel).getByLabelText("Nom"), "Backlog");
    fireEvent.change(within(columnPanel).getByLabelText("Couleur"), {
      target: { value: "#123456" },
    });
    await user.selectOptions(
      within(columnPanel).getByLabelText("Limite WIP"),
      "hard",
    );
    await user.clear(within(columnPanel).getByLabelText("Nombre maximum"));
    await user.type(within(columnPanel).getByLabelText("Nombre maximum"), "2");
    await user.click(
      within(columnPanel).getByRole("button", { name: "Enregistrer" }),
    );
    await user.selectOptions(
      within(columnPanel).getByLabelText("Limite WIP"),
      "none",
    );
    await user.click(
      within(columnPanel).getByRole("button", { name: "Enregistrer" }),
    );
    await user.click(
      within(columnPanel).getByRole("button", {
        name: "Fermer la configuration",
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Options de En cours" }),
    );
    let deletePanel = screen.getByRole("complementary", {
      name: "Configuration de En cours",
    });
    await user.click(
      within(deletePanel).getByRole("button", {
        name: "Supprimer la colonne…",
      }),
    );
    let impact = within(deletePanel).getByRole("alertdialog", {
      name: "Impact de suppression de colonne",
    });
    await user.selectOptions(
      within(impact).getByLabelText("Colonne de destination"),
      board.columns[2].id,
    );
    await user.click(within(impact).getByRole("button", { name: "Annuler" }));
    await user.click(
      within(deletePanel).getByRole("button", {
        name: "Supprimer la colonne…",
      }),
    );
    impact = within(deletePanel).getByRole("alertdialog", {
      name: "Impact de suppression de colonne",
    });
    await user.click(
      within(impact).getByRole("button", { name: "Migrer et supprimer" }),
    );

    await user.click(screen.getByRole("button", { name: "Configurer" }));
    const settings = screen.getByRole("region", {
      name: "Configurer le kanban",
    });
    await user.type(
      within(settings).getByLabelText("Nom de la nouvelle colonne"),
      "Review",
    );
    await user.click(within(settings).getByRole("button", { name: "Ajouter" }));
    await user.click(
      within(settings).getByLabelText("Restreindre les transitions"),
    );
    const rules = within(settings).getAllByRole("checkbox");
    await user.click(rules[1]);
    await user.click(rules[1]);
    await user.click(
      within(settings).getByRole("button", {
        name: "Enregistrer les transitions",
      }),
    );
    const names = within(settings).getAllByLabelText("Nom");
    await user.type(names.at(-1)!, "Team");
    await user.selectOptions(within(settings).getByLabelText("Type"), "number");
    await user.selectOptions(within(settings).getByLabelText("Type"), "list");
    await user.type(
      within(settings).getByLabelText("Options (une par ligne)"),
      "A\nB\n",
    );
    await user.click(
      within(settings).getByLabelText("Épingler sur la carte (maximum 3)"),
    );
    await user.click(
      within(settings).getByRole("button", { name: "Ajouter le champ" }),
    );
    for (const label of [
      "Afficher les tags",
      "Afficher la priorité",
      "Afficher l’échéance",
      "Afficher la source",
      "Afficher le statut d’automatisation",
    ]) {
      await user.click(within(settings).getByLabelText(label));
    }
    await user.click(
      within(settings).getByRole("button", {
        name: "Enregistrer l’affichage",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Fermer la configuration" }),
    );

    await user.click(screen.getByRole("button", { name: "Alpha task" }));
    await user.click(screen.getByRole("button", { name: "Archiver" }));
    await user.click(screen.getByRole("button", { name: "Archives" }));
    const archives = screen.getByRole("region", { name: "Archives" });
    await user.click(
      within(archives).getAllByRole("button", { name: "Restaurer" })[0],
    );
    await user.click(
      within(archives).getAllByRole("button", {
        name: "Supprimer définitivement",
      })[0],
    );
    const confirm = within(archives).getByRole("alertdialog", {
      name: "Confirmer la suppression définitive",
    });
    await user.click(within(confirm).getByRole("button", { name: "Annuler" }));
    await user.click(
      within(archives).getAllByRole("button", {
        name: "Supprimer définitivement",
      })[0],
    );
    await user.click(
      within(archives).getByRole("button", {
        name: "Confirmer la suppression",
      }),
    );
  });

  it("handles boards without enough columns for an automation or deletion destination", async () => {
    const noColumns = createBoard("No columns");
    noColumns.columns = [];
    noColumns.tasks = [];
    seed(noColumns);
    const user = userEvent.setup();
    const firstRender = render(<App />);
    await screen.findByRole("heading", { name: noColumns.name });
    await user.click(screen.getByRole("button", { name: "Automatisations" }));
    await user.click(screen.getByRole("button", { name: "Nouvelle action" }));
    await user.click(
      screen.getByRole("button", { name: "Enregistrer brouillon" }),
    );
    await user.click(screen.getByRole("button", { name: "Prévisualiser" }));
    await user.click(
      screen.getByRole("button", { name: "Enregistrer et activer" }),
    );
    await user.click(screen.getByRole("tab", { name: "Test" }));
    await user.click(screen.getByRole("button", { name: "Exécuter le test" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmer et exécuter" }),
    );
    firstRender.unmount();

    localStorage.clear();
    localStorage.setItem("workonit.language", "fr");
    const oneColumn = createBoard("One column");
    oneColumn.columns = [oneColumn.columns[0]];
    seed(oneColumn);
    render(<App />);
    await screen.findByRole("heading", { name: oneColumn.name });
    await user.click(
      screen.getByRole("button", {
        name: `Options de ${oneColumn.columns[0].name}`,
      }),
    );
    const panel = screen.getByRole("complementary", {
      name: `Configuration de ${oneColumn.columns[0].name}`,
    });
    expect(
      within(panel).getByRole("button", { name: "Supprimer la colonne…" }),
    ).toBeDisabled();
  });

  it("edits source formats, mappings and every schedule kind", async () => {
    const board = seed();
    const primarySource = newSource();
    primarySource.command.timeoutSeconds = undefined;
    const secondarySource = newSource();
    secondarySource.id = "source-secondary";
    secondarySource.name = "Secondary source";
    localStorage.setItem(
      "workonit.sources",
      JSON.stringify([primarySource, secondarySource]),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Produit" });
    await user.click(screen.getByRole("button", { name: "Sources" }));
    await user.click(screen.getByRole("button", { name: primarySource.name }));
    await user.selectOptions(screen.getByLabelText("Format"), "jsonl");
    await user.selectOptions(screen.getByLabelText("Encodage"), "auto");
    fireEvent.change(screen.getByLabelText("Sortie brute"), {
      target: { value: '{"title":"One"}\ninvalid' },
    });
    await user.click(screen.getByRole("button", { name: "Prévisualiser" }));
    expect(screen.getByText(/Titre introuvable|SyntaxError/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Format"), "text");
    fireEvent.change(screen.getByLabelText("Regex"), {
      target: { value: "^(?<title>.+)$" },
    });
    await user.clear(screen.getByLabelText("Sortie brute"));
    await user.type(screen.getByLabelText("Sortie brute"), "Text task");
    await user.click(screen.getByRole("button", { name: "Prévisualiser" }));
    await user.click(
      screen.getByRole("button", { name: /Importer 1 tâche\(s\)/ }),
    );

    await user.click(screen.getByText("Déclencheur planifié"));
    const sourceWorkingDirectory = screen.getByLabelText("Dossier de travail");
    await user.type(sourceWorkingDirectory, "/tmp");
    await user.clear(sourceWorkingDirectory);
    const type = screen.getByLabelText("Type");
    await user.clear(screen.getByLabelText("Secondes"));
    await user.type(screen.getByLabelText("Secondes"), "120");
    await user.selectOptions(type, "daily");
    await user.clear(screen.getByLabelText("Heure"));
    await user.type(screen.getByLabelText("Heure"), "10");
    await user.clear(screen.getByLabelText("Minute"));
    await user.type(screen.getByLabelText("Minute"), "30");
    await user.clear(screen.getByLabelText("Fuseau horaire IANA"));
    await user.type(
      screen.getByLabelText("Fuseau horaire IANA"),
      "Europe/Paris",
    );
    await user.selectOptions(type, "weekly");
    await user.click(screen.getByLabelText("Lun"));
    await user.click(screen.getByLabelText("Mar"));
    await user.selectOptions(type, "cron");
    await user.clear(screen.getByLabelText("Expression cron"));
    await user.type(screen.getByLabelText("Expression cron"), "0 9 * * *");
    await user.clear(screen.getByLabelText("Fuseau horaire IANA"));
    await user.type(screen.getByLabelText("Fuseau horaire IANA"), "UTC");
    await user.selectOptions(type, "interval");
    await user.selectOptions(type, "cron");
    await user.click(
      screen.getByLabelText(
        "Rattraper une seule dernière exécution après veille",
      ),
    );
    await user.click(screen.getByLabelText("Activer le déclencheur"));
    await user.click(
      screen.getByRole("button", { name: "Enregistrer le déclencheur" }),
    );
    await user.click(screen.getByRole("tab", { name: "Mapping" }));
    const mapping = screen.getByText("JSONPath / regex").closest("section")!;
    await user.clear(within(mapping).getByLabelText("Titre"));
    await user.type(within(mapping).getByLabelText("Titre"), "$.name");
    await user.type(
      within(mapping).getByLabelText("Description"),
      "$.description",
    );
    await user.clear(within(mapping).getByLabelText("Description"));
    await user.clear(within(mapping).getByLabelText("Clé externe"));
    await user.type(within(mapping).getByLabelText("Clé externe"), "$.key");
    await user.type(
      within(mapping).getByLabelText("Colonne dynamique"),
      "$.state",
    );
    await user.clear(within(mapping).getByLabelText("Colonne dynamique"));
    await user.selectOptions(
      within(mapping).getByLabelText("Colonne initiale"),
      board.columns[1].id,
    );
    const table = within(mapping).getByLabelText(
      "Correspondances valeur → colonne",
    );
    fireEvent.change(table, { target: { value: "invalid" } });
    fireEvent.blur(table);
    fireEvent.change(table, { target: { value: "{}" } });
    fireEvent.blur(table);
    const scoreMapping = within(mapping).getByLabelText(
      "Chemin ou capture pour Score",
    );
    await user.type(scoreMapping, "$.score");
    await user.clear(scoreMapping);
    await user.type(scoreMapping, "$.score");
    await user.click(
      within(mapping).getByLabelText("Autoriser la mise à jour de Score"),
    );
    await user.click(
      within(mapping).getByLabelText("Autoriser la mise à jour de Score"),
    );
    await user.click(within(mapping).getByLabelText("Mettre à jour le titre"));
    await user.click(within(mapping).getByLabelText("Mettre à jour le titre"));
    await user.click(
      within(mapping).getByLabelText("Mettre à jour la description"),
    );
    await user.click(
      within(mapping).getByLabelText("Mettre à jour la description"),
    );
    await user.click(
      within(mapping).getByLabelText("Déplacement automatique explicite"),
    );
    await user.click(
      within(mapping).getByLabelText(
        "Accepter données partielles si code d’échec",
      ),
    );
    await user.clear(
      within(mapping).getByLabelText("Absences avant signalement"),
    );
    await user.type(
      within(mapping).getByLabelText("Absences avant signalement"),
      "5",
    );
    await user.clear(within(mapping).getByLabelText("Limite sortie (Mo)"));
    await user.type(within(mapping).getByLabelText("Limite sortie (Mo)"), "2");
    await user.click(screen.getByRole("tab", { name: "Aperçu" }));
    await user.click(screen.getByRole("tab", { name: "Sortie" }));
    await user.click(
      screen.getByRole("button", { name: "Enregistrer brouillon" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Nouvelle source TEXT/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Enregistrer et activer" }),
    );
    await user.click(screen.getByRole("button", { name: "Nouvelle source" }));
    await user.click(
      screen.getByRole("button", { name: "Enregistrer brouillon" }),
    );
  });

  it("edits, previews, tests and activates an automation draft", async () => {
    const board = seed();
    localStorage.setItem(
      "workonit.actions",
      JSON.stringify([
        {
          id: "action-1",
          name: "Publish",
          script: "echo ok",
          runner: "/bin/zsh",
          loadProfile: false,
          timeoutSeconds: 300,
          acceptedExitCodes: [0],
          stopOnFailure: true,
          destructive: false,
          enabled: true,
          variants: [],
          secretNames: [],
          directExecution: false,
          arguments: [],
          outputLimitBytes: 1024,
        },
      ]),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: board.name });
    await user.click(screen.getByRole("button", { name: "Automatisations" }));
    await user.click(screen.getByRole("button", { name: /Publish/ }));
    await screen.findByDisplayValue("Publish");

    const conditionType = screen.getByLabelText("Type");
    await user.selectOptions(conditionType, "fieldEquals");
    await user.selectOptions(screen.getByLabelText("Champ"), "tags");
    await user.type(screen.getByLabelText("Valeur"), "urgent");
    await user.selectOptions(conditionType, "fieldContains");
    await user.selectOptions(conditionType, "origin");
    await user.selectOptions(screen.getByLabelText("Origine"), "source");
    expect(
      within(conditionType).queryByRole("option", { name: "Système" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(conditionType, "none");

    await user.click(screen.getByRole("tab", { name: "Commande" }));
    await user.clear(screen.getByLabelText("Nom de l’action"));
    await user.type(screen.getByLabelText("Nom de l’action"), "Publish edited");
    const runner = screen.getByLabelText("Runner");
    expect(runner).toBeInstanceOf(HTMLSelectElement);
    for (const option of shellRunnerOptions()) {
      expect(within(runner).getByRole("option", { name: option })).toBeVisible();
    }
    await user.selectOptions(runner, shellRunnerOptions()[1]);
    await user.clear(screen.getByLabelText("Commande shell"));
    await user.type(screen.getByLabelText("Commande shell"), "echo publish");
    await user.click(
      screen.getByRole("button", { name: "Insérer une variable" }),
    );
    await user.click(screen.getByRole("tab", { name: "Contexte" }));
    const context = screen
      .getByText(
        "Droits administrateur refusés. Commande approuvée = accès normal du compte, sans sandbox.",
      )
      .closest("div")!;
    expect(within(context).queryByText(/Variante (macOS|Windows)/)).toBeNull();
    await user.type(
      within(context).getByLabelText("Dossier de travail"),
      "/tmp",
    );
    await user.clear(within(context).getByLabelText("Dossier de travail"));
    await user.type(
      within(context).getByLabelText("Dossier de travail"),
      "/tmp",
    );
    await user.clear(within(context).getByLabelText("Timeout (secondes)"));
    await user.type(within(context).getByLabelText("Timeout (secondes)"), "60");
    await user.clear(
      within(context).getByLabelText("Codes de sortie acceptés"),
    );
    await user.type(
      within(context).getByLabelText("Codes de sortie acceptés"),
      "0, 2, bad",
    );
    await user.clear(
      within(context).getByLabelText("Limite stdout / stderr (Ko)"),
    );
    await user.type(
      within(context).getByLabelText("Limite stdout / stderr (Ko)"),
      "2",
    );
    await user.type(
      within(context).getByLabelText(
        "Secrets (noms logiques, séparés par des virgules)",
      ),
      "TOKEN, KEY",
    );
    await user.selectOptions(
      within(context).getByLabelText("Validation de stdout"),
      "regex",
    );
    await user.type(
      within(context).getByLabelText("Expression de validation"),
      "ok",
    );
    await user.selectOptions(
      within(context).getByLabelText("Validation de stdout"),
      "jsonPath",
    );
    await user.selectOptions(
      within(context).getByLabelText("Validation de stdout"),
      "none",
    );
    await user.selectOptions(
      within(context).getByLabelText("Validation de stdout"),
      "jsonPath",
    );
    await user.click(
      within(context).getByLabelText(
        "Exécutable direct, sans interprétation shell",
      ),
    );
    await user.type(
      within(context).getByLabelText("Arguments (un par ligne)"),
      "one\ntwo",
    );
    await user.click(
      within(context).getByLabelText("Charger le profil utilisateur"),
    );
    await user.click(
      within(context).getByLabelText(
        "Action destructive — confirmation obligatoire",
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Conditions" }));
    await user.selectOptions(screen.getByLabelText("De"), board.columns[1].id);
    await user.selectOptions(
      screen.getByLabelText("Vers"),
      board.columns[2].id,
    );
    expect(
      screen.getByText("Aucune étape. L’action courante sera utilisée."),
    ).toBeVisible();
    for (let index = 0; index < 3; index += 1) {
      await user.click(
        screen.getByRole("button", { name: "Ajouter l’action courante" }),
      );
    }
    await user.click(
      screen.getAllByLabelText("Arrêter la chaîne si cette étape échoue")[0],
    );
    await user.click(
      screen.getAllByRole("button", {
        name: "Configurer la condition de Publish",
      })[0],
    );
    await user.selectOptions(screen.getByLabelText("Type"), "origin");
    await user.selectOptions(screen.getByLabelText("Origine"), "plugin");
    await user.click(
      screen.getAllByRole("button", {
        name: "Descendre l’étape Publish",
      })[0],
    );
    await user.click(
      screen.getAllByRole("button", {
        name: "Monter l’étape Publish",
      })[1],
    );
    await user.click(
      screen.getAllByRole("button", {
        name: "Retirer l’étape Publish",
      })[2],
    );
    const conditions = screen
      .getByText("Notifications de cette automatisation")
      .closest("div")!;
    for (const label of [
      "Succès",
      "Échecs",
      "Confirmation",
      "Source bloquée",
    ]) {
      await user.selectOptions(
        within(conditions).getByLabelText(label),
        "true",
      );
      await user.selectOptions(
        within(conditions).getByLabelText(label),
        "false",
      );
      await user.selectOptions(
        within(conditions).getByLabelText(label),
        "inherit",
      );
    }
    await user.click(
      screen.getByRole("button", { name: "Enregistrer brouillon" }),
    );
    await user.click(
      screen.getAllByRole("button", { name: "Prévisualiser" })[0],
    );
    expect((await screen.findAllByText(/Runner:/))[0]).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Prévisualiser sans exécuter" }),
    );
    await user.click(screen.getByRole("button", { name: "Exécuter le test" }));
    const confirm = screen.getByRole("alertdialog", {
      name: "Confirmer le test réel",
    });
    await user.click(within(confirm).getByRole("button", { name: "Annuler" }));
    await user.click(screen.getByRole("button", { name: "Exécuter le test" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmer et exécuter" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Enregistrer et activer" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Retour aux actions" }),
    );
    await user.click(screen.getByRole("button", { name: "Nouvelle action" }));
    await user.type(screen.getByLabelText("Commande shell"), "echo fallback");
    await user.click(screen.getByRole("tab", { name: "Contexte" }));
    await user.click(screen.getByRole("tab", { name: "Conditions" }));
    await user.click(
      screen.getByRole("button", { name: "Ajouter l’action courante" }),
    );
    await user.click(screen.getByRole("tab", { name: "Test" }));
    await user.click(
      screen.getByRole("button", { name: "Prévisualiser sans exécuter" }),
    );
    expect((await screen.findAllByText(/Secrets: aucun/))[0]).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Enregistrer brouillon" }),
    );
  });

  it("shows history and updates local application settings", async () => {
    seed();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Produit" });
    await user.click(screen.getByRole("button", { name: "Historique" }));
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes("Déplacée dans") === true,
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Réglages" }));
    const settings = screen.getByRole("region", { name: "Réglages WorkOnIt" });
    for (const name of [
      "Échecs",
      "Confirmations",
      "Sources bloquées",
      "Succès",
    ]) {
      await user.click(within(settings).getByLabelText(name));
    }
    await user.clear(within(settings).getByLabelText("Durée (jours)"));
    await user.type(within(settings).getByLabelText("Durée (jours)"), "0");
    await user.clear(within(settings).getByLabelText("Taille maximale (Mo)"));
    await user.type(
      within(settings).getByLabelText("Taille maximale (Mo)"),
      "0",
    );
    await user.click(
      within(settings).getByLabelText("Inclure historique d’exécution et logs"),
    );
    await user.click(
      within(settings).getByRole("button", { name: "Créer un snapshot" }),
    );
    await user.click(screen.getByRole("button", { name: "Archives" }));
    expect(screen.getByText("Archived task")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kanbans" }));
  });

  it("explains that an automation test needs a sample task", async () => {
    const board = createBoard("Empty automation board");
    seed(board);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: board.name });
    await user.click(screen.getByRole("button", { name: "Automatisations" }));
    await user.click(screen.getByRole("button", { name: "Nouvelle action" }));
    await user.click(screen.getByRole("tab", { name: "Test" }));
    await user.click(screen.getByRole("button", { name: "Exécuter le test" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmer et exécuter" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ajoutez une tâche exemple avant le test réel",
    );
  });
});
