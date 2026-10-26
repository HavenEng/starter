import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { Pool } from "pg";
import type { AuthAudience } from "@/lib/auth/audience";
import {
  AUTH_EMULATOR_HOST,
  AUTH_EMULATOR_PROJECTS,
  AUTH_EMULATOR_URL,
} from "@/lib/firebase/emulator-config";
import {
  AUTH_TEST_DATABASE_URL,
  getAuthTestEnvironment,
} from "../../scripts/auth-e2e-settings.mjs";

type Services = { auth: Record<AuthAudience, Auth>; db: Pool };
export type Scenario = Services & {
  email: string;
  password: string;
  uid: string;
  seed: (audience: AuthAudience, allowStaff?: boolean) => Promise<void>;
};

export const test = base.extend<{ scenario: Scenario }, { services: Services }>(
  {
    services: [
      async ({}, provide) => {
        getAuthTestEnvironment(); // Refuse deployed environments before connecting.
        const previousHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
        const userApp = initializeApp(
          { projectId: AUTH_EMULATOR_PROJECTS.user },
          `auth-test-user-${process.pid}`,
        );
        const staffApp = initializeApp(
          { projectId: AUTH_EMULATOR_PROJECTS.staff },
          `auth-test-staff-${process.pid}`,
        );
        const db = new Pool({
          connectionString: AUTH_TEST_DATABASE_URL,
          connectionTimeoutMillis: 5_000,
        });
        try {
          await provide({
            auth: { user: getAuth(userApp), staff: getAuth(staffApp) },
            db,
          });
        } finally {
          await db.end();
          await Promise.all([deleteApp(userApp), deleteApp(staffApp)]);
          if (previousHost === undefined)
            delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
          else process.env.FIREBASE_AUTH_EMULATOR_HOST = previousHost;
        }
      },
      { scope: "worker" },
    ],
    scenario: async ({ services }, provide) => {
      const id = randomUUID();
      const email = `auth-${id}@example.test`;
      const password = "Starter-test-9!";
      const uid = `case-${id}`;
      try {
        await provide({
          ...services,
          email,
          password,
          uid,
          async seed(audience, allowStaff = false) {
            await services.auth[audience].createUser({
              uid,
              email,
              password,
              displayName: "Initial profile",
            });
            if (audience === "staff" && allowStaff) {
              await services.db.query(
                "INSERT INTO staff_users (firebase_uid, email, display_name, email_verified) VALUES ($1, $2, $3, true)",
                [uid, "provisioned@example.test", "Provisioned profile"],
              );
            }
          },
        });
      } finally {
        for (const audience of ["user", "staff"] as const) {
          const identity = await services.auth[audience]
            .getUserByEmail(email)
            .catch((error) => {
              if (error.code === "auth/user-not-found") return null;
              throw error;
            });
          if (identity) {
            const table = audience === "user" ? "users" : "staff_users";
            await services.db.query(
              `DELETE FROM ${table} WHERE firebase_uid = $1`,
              [identity.uid],
            );
            await services.auth[audience].deleteUser(identity.uid);
          }
        }
      }
    },
  },
);

export async function signIn(
  page: Page,
  scenario: Scenario,
  audience: AuthAudience,
  password = scenario.password,
) {
  await page.goto(audience === "staff" ? "/staff/login" : "/login");
  await page.getByLabel("Email", { exact: true }).fill(scenario.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function getIdToken(scenario: Scenario, audience: AuthAudience) {
  const response = await fetch(
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-${audience}-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: scenario.email,
        password: scenario.password,
        returnSecureToken: true,
      }),
    },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(typeof body.idToken).toBe("string");
  return body.idToken as string;
}

export { expect };
