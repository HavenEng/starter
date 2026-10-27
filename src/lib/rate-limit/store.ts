import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { Pool } from "pg";
import { getPool } from "@/db/pool";
import { errors } from "@/lib/api/application-error";
import { isHostedEnvironment } from "@/lib/firebase/emulator-config";
import { getRatePolicy, type RatePolicy } from "./policies";

export interface RateLimitStore {
  consume(key: string, policy: RatePolicy): Promise<boolean>;
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly pool: Pool) {}
  async consume(key: string, policy: RatePolicy) {
    const result = await this.pool.query(
      `
      INSERT INTO rate_limit_buckets AS b (key, window_start, count, expires_at)
      VALUES ($1, to_timestamp(floor(extract(epoch FROM statement_timestamp()) / $2) * $2), 1,
        to_timestamp((floor(extract(epoch FROM statement_timestamp()) / $2) + 1) * $2))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN b.expires_at <= statement_timestamp() THEN 1 ELSE LEAST(b.count + 1, $3 + 1) END,
        window_start = CASE WHEN b.expires_at <= statement_timestamp() THEN EXCLUDED.window_start ELSE b.window_start END,
        expires_at = CASE WHEN b.expires_at <= statement_timestamp() THEN EXCLUDED.expires_at ELSE b.expires_at END
      RETURNING count`,
      [key, policy.windowSeconds, policy.limit],
    );
    return result.rows[0].count <= policy.limit;
  }
}

export function clientIdentifier(
  headers: Headers,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  // Only a configured, trusted ingress may supply identity. Never use a client
  // cookie, request ID, or arbitrary X-Forwarded-For value as a limiter key.
  const header =
    env.VERCEL === "1"
      ? "x-vercel-forwarded-for"
      : env.RATE_LIMIT_TRUSTED_IP_HEADER;
  const value = header ? headers.get(header)?.trim() : undefined;
  return value && isIP(value) ? value : "unattributed";
}

export async function enforceRateLimit(
  path: string,
  method: string,
  headers: Headers,
) {
  try {
    const local =
      !isHostedEnvironment(process.env) &&
      (process.env.APP_ENV === "local" ||
        (process.env.APP_ENV === undefined &&
          process.env.NODE_ENV === "development"));
    const secret =
      process.env.RATE_LIMIT_KEY_SECRET ||
      (local ? "local-only-rate-limit-key-change-before-deploy" : "");
    if (secret.length < 32 || (!local && secret.startsWith("local-only")))
      throw new Error("Rate limit secret required.");
    let policy = getRatePolicy(path, method);
    const testMode = process.env.RATE_LIMIT_TEST_MODE;
    if (testMode) {
      if (
        !local ||
        !(
          process.env.AUTH_E2E === "1" ||
          process.env.OBSERVABILITY_E2E === "1" ||
          process.env.BROWSER_E2E === "1"
        ) ||
        !["high", "low"].includes(testMode)
      ) {
        throw new Error(
          "Rate-limit test configuration requires an isolated local runner.",
        );
      }
      policy =
        testMode === "high"
          ? { ...policy, limit: 100_000 }
          : {
              ...policy,
              limit: policy.id === "default" ? 4 : 2,
              windowSeconds: 60,
            };
    }
    const subject = createHmac("sha256", secret)
      .update(clientIdentifier(headers))
      .digest("hex");
    // Unknown methods and URLs cannot manufacture buckets. Overrides group
    // related audiences and administrative targets together deliberately.
    return await new PostgresRateLimitStore(getPool()).consume(
      `${policy.id}:${subject}`,
      policy,
    );
  } catch (cause) {
    throw errors.unavailable(cause);
  }
}
