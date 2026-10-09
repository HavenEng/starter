import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorFallback } from "./error-fallback";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException: capture }));
afterEach(() => {
  cleanup();
  capture.mockClear();
});

describe("error recovery", () => {
  it("reports client errors, shows generic copy, and invokes Next.js retry", () => {
    const retry = vi.fn();
    render(
      <ErrorFallback error={new Error("Internal details")} retry={retry} />,
    );
    expect(screen.queryByText("Internal details")).toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("does not report the browser copy of a server error", () => {
    render(
      <ErrorFallback
        error={Object.assign(new Error("Server details"), {
          digest: "server-digest",
        })}
        retry={vi.fn()}
      />,
    );
    expect(capture).not.toHaveBeenCalled();
  });
});
