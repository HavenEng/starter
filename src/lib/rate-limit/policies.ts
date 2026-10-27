export type RatePolicy = { id: string; limit: number; windowSeconds: number };
const policies: Record<string, RatePolicy> = {
  default: { id: "default", limit: 120, windowSeconds: 60 },
  session: { id: "session", limit: 20, windowSeconds: 60 },
  reset: { id: "reset", limit: 5, windowSeconds: 900 },
  password: { id: "password", limit: 5, windowSeconds: 900 },
  administration: { id: "administration", limit: 30, windowSeconds: 60 },
  logout: { id: "logout", limit: 60, windowSeconds: 60 },
};

// Match stable route groups; neither query strings nor target IDs form a bucket.
const overrides = [
  {
    method: "POST",
    path: /^\/api\/auth\/(staff\/)?session\/?$/,
    policy: "session",
  },
  {
    method: "POST",
    path: /^\/api\/auth\/(staff\/)?password-reset\/?$/,
    policy: "reset",
  },
  {
    method: "POST",
    path: /^\/api\/auth\/(staff\/)?change-password\/?$/,
    policy: "password",
  },
  {
    method: "POST",
    path: /^\/api\/auth\/(staff\/)?logout\/?$/,
    policy: "logout",
  },
  {
    method: "POST",
    path: /^\/api\/staff\/(users|members)\/[^/]+\/disable\/?$/,
    policy: "administration",
  },
  {
    method: "PUT",
    path: /^\/api\/staff\/members\/[^/]+\/roles\/[^/]+\/?$/,
    policy: "administration",
  },
  {
    method: "DELETE",
    path: /^\/api\/staff\/members\/[^/]+\/roles\/[^/]+\/?$/,
    policy: "administration",
  },
];

export function getRatePolicy(path: string, method: string): RatePolicy {
  const selected = overrides.find(
    (rule) => rule.method === method && rule.path.test(path),
  );
  return policies[selected?.policy ?? "default"];
}
