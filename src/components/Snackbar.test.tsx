import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Snackbar } from "./Snackbar";

describe("Snackbar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("closes automatically after five seconds", () => {
    const onClose = vi.fn();
    render(<Snackbar message="Enregistré" onClose={onClose} />);

    act(() => vi.advanceTimersByTime(4_999));
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restarts the delay for a new message and uses the latest close handler", () => {
    const firstOnClose = vi.fn();
    const latestOnClose = vi.fn();
    const { rerender } = render(
      <Snackbar message="Premier message" onClose={firstOnClose} />,
    );

    act(() => vi.advanceTimersByTime(3_000));
    rerender(
      <Snackbar message="Second message" onClose={latestOnClose} />,
    );
    act(() => vi.advanceTimersByTime(4_999));
    expect(firstOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(latestOnClose).toHaveBeenCalledOnce();
  });
});
