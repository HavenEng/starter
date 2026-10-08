import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const mocks = vi.hoisted(() => ({
  auth: {},
  createUser: vi.fn(),
  signIn: vi.fn(),
  setPersistence: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: mocks.createUser,
  signInWithEmailAndPassword: mocks.signIn,
  setPersistence: mocks.setPersistence,
  signOut: mocks.signOut,
  inMemoryPersistence: {},
}));
vi.mock("@/lib/firebase/client", () => ({
  getFirebaseAuth: () => mocks.auth,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function credential(token: string) {
  return { user: { getIdToken: vi.fn().mockResolvedValue(token) } };
}

function fillSignup() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "new-user@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "test-password" },
  });
}

describe("signup recovery", () => {
  it.each(["server", "network"])(
    "signs in the created account after a %s session failure",
    async (failure) => {
      mocks.createUser.mockResolvedValue(credential("signup-token"));
      mocks.signIn.mockResolvedValue(credential("fresh-signin-token"));
      const fetchSession = vi.fn();
      if (failure === "server") {
        fetchSession.mockResolvedValueOnce({
          ok: false,
          json: async () => {
            throw new SyntaxError("Not JSON");
          },
        });
      } else {
        fetchSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      }
      fetchSession.mockResolvedValueOnce({ ok: true });
      vi.stubGlobal("fetch", fetchSession);

      render(<AuthForm mode="signup" />);
      fillSignup();
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));

      const retry = await screen.findByRole("button", {
        name: "Retry sign-in",
      });
      expect(screen.getByLabelText("Email")).toHaveProperty("readOnly", true);
      expect(
        screen.getByText("Your account was created. Retry sign-in to finish."),
      ).toBeDefined();
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();

      fireEvent.click(retry);

      await waitFor(() =>
        expect(mocks.replace).toHaveBeenCalledWith("/account"),
      );
      expect(mocks.createUser).toHaveBeenCalledTimes(1);
      expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith(
        mocks.auth,
        "new-user@example.com",
        "test-password",
      );
      expect(fetchSession).toHaveBeenNthCalledWith(
        2,
        "/api/auth/session",
        expect.objectContaining({
          body: JSON.stringify({ idToken: "fresh-signin-token" }),
        }),
      );
      expect(mocks.signOut).toHaveBeenCalledOnce();
    },
  );

  it("keeps the recovery flow after a failed retry and allows correcting the password", async () => {
    mocks.createUser.mockResolvedValue(credential("signup-token"));
    mocks.signIn
      .mockRejectedValueOnce({ code: "auth/wrong-password" })
      .mockResolvedValueOnce(credential("fresh-signin-token"));
    const fetchSession = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchSession);

    render(<AuthForm mode="signup" />);
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry sign-in" }),
    );

    await screen.findByText("The email or password is incorrect.");
    expect(screen.getByLabelText("Password")).toHaveProperty("readOnly", false);
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "corrected-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry sign-in" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/account"));
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenLastCalledWith(
      mocks.auth,
      "new-user@example.com",
      "corrected-password",
    );
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("retries account creation when Firebase never created the account", async () => {
    mocks.createUser
      .mockRejectedValueOnce({ code: "auth/weak-password" })
      .mockResolvedValueOnce(credential("signup-token"));
    const fetchSession = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSession);

    render(<AuthForm mode="signup" />);
    fillSignup();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByText("Choose a stronger password.");
    expect(screen.getByLabelText("Email")).toHaveProperty("readOnly", false);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/account"));
    expect(mocks.createUser).toHaveBeenCalledTimes(2);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });
});
