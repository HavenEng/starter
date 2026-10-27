// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getRatePolicy } from "./policies";
import { clientIdentifier } from "./store";
describe("rate-limit policy selection", () => {
  it("applies defaults and stable method-specific overrides", () => {
    expect(getRatePolicy("/api/future/123", "GET").limit).toBe(120);
    expect(getRatePolicy("/api/auth/password-reset", "POST").limit).toBe(5);
    expect(getRatePolicy("/api/auth/password-reset", "GET").id).toBe("default");
    expect(getRatePolicy("/api/staff/members/a/roles/b", "PUT")).toEqual(
      getRatePolicy("/api/staff/members/c/roles/d", "PUT"),
    );
  });
  it("ignores untrusted forwarding headers and rejects invalid trusted IP values", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4",
      "x-client-ip": "1.2.3.5",
    });
    expect(clientIdentifier(headers, {})).toBe("unattributed");
    expect(
      clientIdentifier(headers, {
        RATE_LIMIT_TRUSTED_IP_HEADER: "x-client-ip",
      }),
    ).toBe("1.2.3.5");
    headers.set("x-client-ip", "1.2.3.5, 6.7.8.9");
    expect(
      clientIdentifier(headers, {
        RATE_LIMIT_TRUSTED_IP_HEADER: "x-client-ip",
      }),
    ).toBe("unattributed");
  });
});
