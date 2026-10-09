import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), capture: vi.fn() }));
vi.mock("firebase/auth", () => ({
  setPersistence: vi.fn(),
  inMemoryPersistence: {},
  signInWithEmailAndPassword: mocks.signIn,
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseAuth: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.capture }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sign-in error reporting", () => {
  it.each([undefined, "a".repeat(32)])(
    "handles an HTTP gateway failure and its server acknowledgement (%s)",
    async (eventId) => {
      mocks.signIn.mockResolvedValueOnce({
        user: { getIdToken: async () => "synthetic-token" },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          new Response(null, {
            status: 504,
            headers: {
              "x-request-id": "request-123",
              ...(eventId ? { "x-sentry-event-id": eventId } : {}),
            },
          }),
        ),
      );
      render(<AuthForm mode="login" audience="staff" />);
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "staff@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "password" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(
        await screen.findByText(
          "We could not start your session. Please try again.",
        ),
      ).toBeDefined();
      expect(
        screen
          .getByRole("button", { name: "Sign in" })
          .hasAttribute("disabled"),
      ).toBe(false);
      if (eventId) expect(mocks.capture).not.toHaveBeenCalled();
      else
        expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error), {
          tags: {
            operation: "auth.sign-in",
            audience: "staff",
            requestId: "request-123",
            errorCode: undefined,
            status: "504",
          },
        });
    },
  );
  it.each(["auth/invalid-credential", "auth/network-request-failed"])(
    "handles %s without changing the form's recovery",
    async (code) => {
      const error = Object.assign(new Error("Authentication failed"), { code });
      mocks.signIn.mockRejectedValueOnce(error);
      render(<AuthForm mode="login" audience="staff" />);
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "staff@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "password" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(
        await screen.findByText(
          code === "auth/invalid-credential"
            ? "The email or password is incorrect."
            : "Authentication failed",
        ),
      ).toBeDefined();
      expect(
        screen
          .getByRole("button", { name: "Sign in" })
          .hasAttribute("disabled"),
      ).toBe(false);
      if (code === "auth/invalid-credential")
        expect(mocks.capture).not.toHaveBeenCalled();
      else
        expect(mocks.capture).toHaveBeenCalledWith(error, {
          tags: {
            operation: "auth.sign-in",
            audience: "staff",
            requestId: undefined,
            errorCode: code,
          },
        });
    },
  );
});
