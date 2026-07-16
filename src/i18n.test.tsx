import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Icon } from "./components/Icon";

describe("localization and icons", () => {
  afterEach(() => vi.resetModules());

  it("uses French for a French system locale and interpolates copy", async () => {
    localStorage.clear();
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "fr-FR",
    });
    const { copy, default: i18n } = await import("./i18n");
    expect(i18n.language).toBe("fr");
    expect(copy("c314", { name: "Tâche" })).toBe("Monter Tâche");
  });

  it("prefers a saved language and exposes decorative and labelled icons", async () => {
    localStorage.setItem("workonit.language", "en");
    const { default: i18n } = await import("./i18n");
    expect(i18n.language).toBe("en");
    const { rerender } = render(<Icon name="task" />);
    expect(screen.getByText("task")).toHaveAttribute("aria-hidden", "true");
    rerender(<Icon name="task" label="Task status" />);
    expect(screen.getByLabelText("Task status")).not.toHaveAttribute(
      "aria-hidden",
    );
  });
});
