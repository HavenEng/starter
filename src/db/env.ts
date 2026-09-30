export function getDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
      parsed.hostname &&
      parsed.pathname.length > 1
    ) {
      return value;
    }
  } catch {
    // Use the same message for malformed and unsupported URLs.
  }

  throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
}
