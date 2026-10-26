import { describe, expect, it } from "vitest";
import { isRecentAuthentication } from "./recent-auth";

describe("recent authentication", () => {
  it.each([0, 299, 300])("accepts an age of %i seconds", (age) => {
    expect(isRecentAuthentication(1_000 - age, 1_000)).toBe(true);
  });
  it.each([301, -1])("rejects an age of %i seconds", (age) => {
    expect(isRecentAuthentication(1_000 - age, 1_000)).toBe(false);
  });
  it.each([undefined, null, "1000", NaN, Infinity, 999.5])(
    "rejects an invalid auth_time: %s",
    (value) => expect(isRecentAuthentication(value, 1_000)).toBe(false),
  );
});
