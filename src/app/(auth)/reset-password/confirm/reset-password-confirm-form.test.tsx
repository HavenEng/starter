import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordConfirmForm } from "./reset-password-confirm-form";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), report: vi.fn() }));
vi.mock("firebase/auth", () => ({
  verifyPasswordResetCode: async () => "reset@example.test",
  confirmPasswordReset: mocks.confirm,
}));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseAuth: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/observability/report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/report")>()),
  reportUnexpectedError: mocks.report,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("reset confirmation timeout", () => {
  it.each(["resolve", "reject"] as const)(
    "keeps recovery after a late provider %s and does not replay the reset",
    async (outcome) => {
      let finish!: () => void;
      mocks.confirm.mockReturnValueOnce(
        new Promise<void>((resolve, reject) => {
          finish =
            outcome === "resolve"
              ? resolve
              : () => reject(new Error("Late provider failure"));
        }),
      );
      render(<ResetPasswordConfirmForm oobCode="synthetic-code" />);
      await screen.findByText("Set a new password for reset@example.test.");
      vi.useFakeTimers();
      fireEvent.change(screen.getByLabelText("New password"), {
        target: { value: "New-password-9!" },
      });
      fireEvent.change(screen.getByLabelText("Confirm new password"), {
        target: { value: "New-password-9!" },
      });
      const form = screen
        .getByRole("button", { name: "Update password" })
        .closest("form")!;
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(mocks.confirm).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(
        screen.getByRole("heading", { name: "Sign in again" }),
      ).toBeDefined();
      expect(screen.queryByLabelText("New password")).toBeNull();
      expect(mocks.report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
        operation: "auth.confirm-password-reset",
        audience: "user",
      });
      await act(async () => finish());
      expect(
        screen.getByRole("heading", { name: "Sign in again" }),
      ).toBeDefined();
      expect(
        screen.queryByRole("heading", { name: "Password updated" }),
      ).toBeNull();
      expect(mocks.confirm).toHaveBeenCalledOnce();
      expect(mocks.report).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
