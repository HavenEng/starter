import { describe, it, expect } from "vitest";
import { hasStaffScope } from "./permissions";
describe("staff permission scopes", () => {
  it("denies empty or unknown assignments and combines supported assignments", () => {
    expect(hasStaffScope([], "staff:portal:read")).toBe(false);
    expect(hasStaffScope(["owner"], "staff:portal:read")).toBe(false);
    expect(hasStaffScope(["staff"], "users:disable")).toBe(false);
    expect(hasStaffScope(["staff", "admin"], "users:disable")).toBe(true);
    expect(hasStaffScope(["admin"], "staff:portal:read")).toBe(true);
  });
});
