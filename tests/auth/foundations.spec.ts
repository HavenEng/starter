import { test, expect, signIn, getIdToken, type Scenario } from "./fixtures";
import type { AuthAudience } from "@/lib/auth/audience";
import type { Page, BrowserContext } from "@playwright/test";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

async function authHeaders(context: BrowserContext, origin: string) {
  return {
    Origin: origin,
    Cookie: (await context.cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
  };
}

async function rolesFor(scenario: Scenario, uid: string, keys: string[]) {
  const { rows } = await scenario.db.query(
    "SELECT id FROM staff_users WHERE firebase_uid = $1",
    [uid],
  );
  const id = rows[0].id as string;
  await scenario.db.query(
    "DELETE FROM staff_user_roles WHERE staff_user_id = $1",
    [id],
  );
  for (const key of keys)
    await scenario.db.query(
      "INSERT INTO staff_user_roles (staff_user_id, role_id) SELECT $1, id FROM roles WHERE key = $2",
      [id, key],
    );
  return id;
}

async function admin(page: Page, scenario: Scenario) {
  await scenario.seed("staff", true);
  const id = await rolesFor(scenario, scenario.uid, ["admin"]);
  await signIn(page, scenario, "staff");
  await expect(page).toHaveURL(/\/private$/);
  return id;
}

async function target(
  scenario: Scenario,
  audience: AuthAudience,
  keys: string[] = [],
) {
  const uid = `target-${scenario.uid}`;
  const email = `target-${scenario.email}`;
  await scenario.auth[audience].createUser({
    uid,
    email,
    password: scenario.password,
  });
  const table = audience === "staff" ? "staff_users" : "users";
  const { rows } = await scenario.db.query(
    `INSERT INTO ${table} (firebase_uid, email) VALUES ($1, $2) RETURNING id`,
    [uid, email],
  );
  if (audience === "staff") await rolesFor(scenario, uid, keys);
  return { id: rows[0].id as string, uid, email };
}

test.afterEach(async ({ scenario }) => {
  for (const audience of ["staff", "user"] as const) {
    const table = audience === "staff" ? "staff_users" : "users";
    await scenario.db.query(`DELETE FROM ${table} WHERE firebase_uid = $1`, [
      `target-${scenario.uid}`,
    ]);
    await scenario.auth[audience]
      .deleteUser(`target-${scenario.uid}`)
      .catch((error) => {
        if (error.code !== "auth/user-not-found") throw error;
      });
  }
});

test("zero-role staff can change their password but have no scoped page or API access", async ({
  page,
  scenario,
  baseURL,
}) => {
  await scenario.seed("staff", true);
  const id = await rolesFor(scenario, scenario.uid, []);
  await signIn(page, scenario, "staff");
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  const { rows } = await scenario.db.query(
    "SELECT id FROM roles WHERE key = 'admin'",
  );
  expect(
    (
      await page.request.put(`/api/staff/members/${id}/roles/${rows[0].id}`, {
        headers: await authHeaders(page.context(), baseURL!),
      })
    ).status(),
  ).toBe(403);
  await page.goto("/private/admin");
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await page.goto("/private/account/change-password");
  await expect(
    page.getByRole("heading", { name: "Change password" }),
  ).toBeVisible();
  await page.goto("/private");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/login$/);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "firebase_staff_session",
    ),
  ).toBe(false);
  await signIn(page, scenario, "staff");
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
});

test("role assignments combine, preserve other roles, and revoke access with existing cookies", async ({
  page,
  browser,
  scenario,
  baseURL,
}) => {
  await admin(page, scenario);
  const member = await target(scenario, "staff", ["staff"]);
  const { rows } = await scenario.db.query("SELECT id, key FROM roles");
  const role = Object.fromEntries(rows.map((row) => [row.key, row.id]));
  const context = await browser.newContext({ baseURL });
  try {
    const memberPage = await context.newPage();
    await signIn(memberPage, { ...scenario, ...member }, "staff");
    await expect(memberPage).toHaveURL(/\/private$/);
    await memberPage.goto(`${baseURL}/private/admin`);
    await expect(
      memberPage.getByRole("heading", { name: "Access denied" }),
    ).toBeVisible();
    const path = `/api/staff/members/${member.id}/roles/`;
    for (let i = 0; i < 2; i++)
      expect(
        (
          await page.request.put(path + role.admin, {
            headers: await authHeaders(page.context(), baseURL!),
          })
        ).status(),
      ).toBe(200);
    expect(
      (
        await scenario.db.query(
          "SELECT role_id FROM staff_user_roles WHERE staff_user_id = $1",
          [member.id],
        )
      ).rowCount,
    ).toBe(2);
    await memberPage.reload();
    await expect(
      memberPage.getByRole("heading", { name: "Staff administration" }),
    ).toBeVisible();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await page.request.delete(path + role.staff, {
            headers: await authHeaders(page.context(), baseURL!),
          })
        ).status(),
      ).toBe(200);
    await memberPage.goto(`${baseURL}/private`);
    await expect(
      memberPage.getByRole("heading", { name: "Private area" }),
    ).toBeVisible();
    expect(
      (
        await page.request.delete(path + role.admin, {
          headers: await authHeaders(page.context(), baseURL!),
        })
      ).status(),
    ).toBe(200);
    await memberPage.reload();
    await expect(
      memberPage.getByRole("heading", { name: "Access denied" }),
    ).toBeVisible();
    const partial = await context.request.get(
      `${baseURL}/private/admin?_rsc=roles`,
      {
        headers: {
          ...(await authHeaders(context, baseURL!)),
          RSC: "1",
          "Next-Router-Prefetch": "1",
        },
      },
    );
    expect(await partial.text()).not.toContain(
      "Administrative access is enabled",
    );
  } finally {
    await context.close();
  }
});

test("concurrent admin-role removals preserve one enabled admin", async ({
  page,
  browser,
  scenario,
  baseURL,
}) => {
  const actorId = await admin(page, scenario);
  const member = await target(scenario, "staff", ["admin", "staff"]);
  const { rows } = await scenario.db.query(
    "SELECT id FROM roles WHERE key = 'admin'",
  );
  const roleId = rows[0].id;
  const context = await browser.newContext({ baseURL });
  try {
    const response = await context.request.post(
      `${baseURL}/api/auth/staff/session`,
      {
        headers: await authHeaders(page.context(), baseURL!),
        data: {
          idToken: await getIdToken({ ...scenario, ...member }, "staff"),
        },
      },
    );
    expect(response.status()).toBe(200);
    const results = await Promise.all([
      page.request.delete(`/api/staff/members/${actorId}/roles/${roleId}`, {
        headers: await authHeaders(page.context(), baseURL!),
      }),
      context.request.delete(
        `${baseURL}/api/staff/members/${member.id}/roles/${roleId}`,
        { headers: await authHeaders(context, baseURL!) },
      ),
    ]);
    expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
    expect(
      (
        await scenario.db.query(
          "SELECT DISTINCT s.id FROM staff_users s JOIN staff_user_roles a ON a.staff_user_id = s.id JOIN roles r ON r.id = a.role_id WHERE r.key = 'admin' AND s.disabled_at IS NULL",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await context.close();
  }
});

test("disable retains local denial after provider failure and retry reconciles Firebase", async ({
  page,
  scenario,
  baseURL,
}) => {
  await admin(page, scenario);
  const member = await target(scenario, "user");
  await scenario.auth.user.deleteUser(member.uid);
  const path = `/api/staff/users/${member.id}/disable`;
  const headers = await authHeaders(page.context(), baseURL!);
  expect((await page.request.post(path, { headers })).status()).toBe(503);
  expect(
    (
      await scenario.db.query("SELECT disabled_at FROM users WHERE id = $1", [
        member.id,
      ])
    ).rows[0].disabled_at,
  ).toBeInstanceOf(Date);
  await scenario.auth.user.createUser({
    uid: member.uid,
    email: member.email,
    password: scenario.password,
  });
  const token = await getIdToken({ ...scenario, ...member }, "user");
  expect(
    (
      await page.request.post("/api/auth/session", {
        headers,
        data: { idToken: token },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.post(path, { headers })).status()).toBe(200);
  expect((await scenario.auth.user.getUser(member.uid)).disabled).toBe(true);
});

for (const audience of ["user", "staff"] as const) {
  test(`admins disable ${audience} accounts and old sessions lose access`, async ({
    page,
    browser,
    scenario,
    baseURL,
  }) => {
    const actor = await admin(page, scenario);
    const member = await target(scenario, audience, ["staff"]);
    const context = await browser.newContext({ baseURL });
    try {
      const memberPage = await context.newPage();
      await signIn(memberPage, { ...scenario, ...member }, audience);
      await expect(memberPage).toHaveURL(
        audience === "staff" ? /\/private$/ : /\/account$/,
      );
      const route = `/api/staff/${audience === "staff" ? "members" : "users"}/${member.id}/disable`;
      expect(
        (
          await context.request.post(`${baseURL}${route}`, {
            headers: await authHeaders(context, baseURL!),
          })
        ).status(),
      ).toBe(audience === "staff" ? 403 : 401);
      for (let i = 0; i < 2; i++)
        expect(
          (
            await page.request.post(route, {
              headers: await authHeaders(page.context(), baseURL!),
            })
          ).status(),
        ).toBe(200);
      expect((await scenario.auth[audience].getUser(member.uid)).disabled).toBe(
        true,
      );
      await memberPage.reload();
      await expect(memberPage).toHaveURL(
        audience === "staff" ? /\/staff\/login$/ : /\/login$/,
      );
      expect(
        (
          await page.request.post(`/api/staff/members/${actor}/disable`, {
            headers: await authHeaders(page.context(), baseURL!),
          })
        ).status(),
      ).toBe(409);
    } finally {
      await context.close();
    }
  });

  test(`${audience} password change verifies current credentials and invalidates other sessions`, async ({
    page,
    browser,
    scenario,
    baseURL,
  }) => {
    const currentPassword = "Old1!" + "x".repeat(59);
    const newPassword = "Aa1!" + "x".repeat(60);
    await scenario.seed(audience, true);
    await scenario.auth[audience].updateUser(scenario.uid, {
      password: currentPassword,
    });
    await signIn(page, scenario, audience, currentPassword);
    await expect(page).toHaveURL(
      audience === "staff" ? /\/private$/ : /\/account$/,
    );
    const context = await browser.newContext({ baseURL });
    try {
      await context.addCookies(await page.context().cookies());
      // Firebase records auth/revocation timestamps in whole seconds.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await page.goto(
        audience === "staff"
          ? "/private/account/change-password"
          : "/account/change-password",
      );
      for (const label of [
        "Current password",
        "New password",
        "Confirm new password",
      ]) {
        await expect(page.getByLabel(label, { exact: true })).toHaveAttribute(
          "maxlength",
          "64",
        );
      }
      for (const field of ["currentPassword", "newPassword"]) {
        const invalid = await page.request.post(
          `/api/auth/${audience === "staff" ? "staff/" : ""}change-password`,
          {
            headers: await authHeaders(page.context(), baseURL!),
            data: {
              currentPassword,
              newPassword,
              passwordConfirmation: newPassword,
              [field]: "x".repeat(65),
            },
          },
        );
        expect(invalid.status()).toBe(400);
      }
      await page
        .getByLabel("Current password", { exact: true })
        .fill("incorrect-password");
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill(newPassword);
      await page
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(
        page.getByText("The current password is incorrect.", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("Current password", { exact: true })
        .fill(currentPassword);
      await page
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Password updated" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Sign in again", exact: true })
        .click();
      await expect(page).toHaveURL(
        audience === "staff" ? /\/staff\/login$/ : /\/login$/,
      );
      const oldPage = await context.newPage();
      await oldPage.goto(
        `${baseURL}${audience === "staff" ? "/private" : "/account"}`,
      );
      await expect(oldPage).toHaveURL(
        audience === "staff" ? /\/staff\/login$/ : /\/login$/,
      );
      await signIn(page, scenario, audience, currentPassword);
      await expect(
        page.getByText("The email or password is incorrect."),
      ).toBeVisible();
      await signIn(page, scenario, audience, newPassword);
      await expect(page).toHaveURL(
        audience === "staff" ? /\/private$/ : /\/account$/,
      );
    } finally {
      await context.close();
    }
  });
}

test("example seeded users can back matching Firebase identities and bootstrap preserves assignments", async ({
  scenario,
  page,
}) => {
  const execute = promisify(execFile);
  const env = {
    ...process.env,
    NODE_ENV: "development" as const,
    APP_ENV: "local",
    DATABASE_URL: "postgresql://auth_e2e:auth_e2e@127.0.0.1:5433/auth_e2e",
  };
  await execute(process.execPath, ["scripts/db-seed.mjs", "--only", "users"], {
    env,
  });
  try {
    await scenario.auth.user.createUser({
      uid: "seed-user-alex",
      email: "alex@example.test",
      password: scenario.password,
    });
    await signIn(
      page,
      { ...scenario, uid: "seed-user-alex", email: "alex@example.test" },
      "user",
    );
    await expect(page).toHaveURL(/\/account$/);
    await scenario.seed("staff", true);
    for (let i = 0; i < 2; i++)
      await execute(
        process.execPath,
        [
          "scripts/staff-bootstrap-admin.mjs",
          "--uid",
          scenario.uid,
          "--database",
          "auth_e2e",
        ],
        { env },
      );
    expect(
      (
        await scenario.db.query(
          "SELECT a.role_id FROM staff_user_roles a JOIN staff_users s ON s.id = a.staff_user_id WHERE s.firebase_uid = $1",
          [scenario.uid],
        )
      ).rowCount,
    ).toBe(2);
  } finally {
    await scenario.auth.user.deleteUser("seed-user-alex").catch(() => {});
    await scenario.db.query(
      "DELETE FROM users WHERE firebase_uid LIKE 'seed-user-%'",
    );
  }
});
