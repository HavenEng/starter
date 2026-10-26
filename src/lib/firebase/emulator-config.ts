export const AUTH_TEST_PORTS = {
  app: 3102,
  database: 5433,
  proxy: 9099,
  user: 9098,
  staff: 9100,
  userHub: 4402,
  staffHub: 4403,
  userLogging: 4502,
  staffLogging: 4503,
} as const;
export const AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_TEST_PORTS.proxy}`;
export const AUTH_EMULATOR_URL = `http://${AUTH_EMULATOR_HOST}`;
export const AUTH_EMULATOR_DATABASE_URL =
  "postgresql://auth_e2e:auth_e2e@127.0.0.1:5433/auth_e2e";
export const AUTH_EMULATOR_PROJECTS = {
  user: "demo-starter-user",
  staff: "demo-starter-staff",
} as const;

// Host adapters are additional safeguards; APP_ENV is the portable contract.
export function isHostedEnvironment(
  env: Readonly<Record<string, string | undefined>>,
) {
  return [
    "VERCEL",
    "VERCEL_ENV",
    "NETLIFY",
    "CONTEXT",
    "AWS_EXECUTION_ENV",
    "AWS_LAMBDA_FUNCTION_NAME",
    "K_SERVICE",
    "WEBSITE_INSTANCE_ID",
    "RENDER_SERVICE_ID",
    "FLY_APP_NAME",
    "RAILWAY_ENVIRONMENT_ID",
  ].some((name) => Boolean(env[name]));
}

// Shared by the build, Node instrumentation, and lazy Admin initialization.
// NODE_ENV=production is allowed for the loopback production-build test server.
export function getAuthEmulatorConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (
    env.APP_ENV !== undefined &&
    !["local", "preview", "production"].includes(env.APP_ENV)
  ) {
    throw new Error("APP_ENV must be local, preview, or production.");
  }
  if (env.AUTH_E2E !== "1") {
    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error("The Auth Emulator requires AUTH_E2E=1.");
    }
    return null;
  }

  if (env.APP_ENV !== "local") {
    throw new Error("Auth Emulator tests require APP_ENV=local.");
  }
  if (isHostedEnvironment(env) || env.OBSERVABILITY_E2E === "1") {
    throw new Error("Auth Emulator tests require a separate local app server.");
  }
  if (env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_EMULATOR_HOST) {
    throw new Error(`Auth Emulator tests require ${AUTH_EMULATOR_HOST}.`);
  }
  if (env.DATABASE_URL !== AUTH_EMULATOR_DATABASE_URL) {
    throw new Error(
      "Auth Emulator tests require the isolated auth_e2e database on port 5433.",
    );
  }
  for (const [audience, projectId] of Object.entries(AUTH_EMULATOR_PROJECTS)) {
    const prefix = audience.toUpperCase();
    if (
      env[`FIREBASE_${prefix}_PROJECT_ID`] !== projectId ||
      env[`NEXT_PUBLIC_FIREBASE_${prefix}_PROJECT_ID`] !== projectId
    ) {
      throw new Error(`Auth Emulator tests require the ${projectId} project.`);
    }
  }
  return { host: AUTH_EMULATOR_HOST, projects: AUTH_EMULATOR_PROJECTS };
}

export function assertAuthBuildMode(
  builtMode: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const emulator = getAuthEmulatorConfig(env);
  if (
    !["0", "1"].includes(builtMode ?? "") ||
    (builtMode === "1") !== Boolean(emulator)
  ) {
    throw new Error(
      "Auth build/runtime modes differ. Rebuild for this environment.",
    );
  }
  return emulator;
}
