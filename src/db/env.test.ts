import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "./env";

describe("getDatabaseUrl", () => {
  it("accepts a PostgreSQL connection URL", () => {
    const url = "postgresql://starter:starter@localhost:5432/starter";
    expect(getDatabaseUrl(url)).toBe(url);
  });

  it("explains when the URL is missing", () => {
    expect(() => getDatabaseUrl("")).toThrow("DATABASE_URL is required");
  });

  it("rejects an unsupported connection URL", () => {
    expect(() => getDatabaseUrl("https://example.com/database")).toThrow(
      "DATABASE_URL must be a PostgreSQL connection URL",
    );
  });
});
