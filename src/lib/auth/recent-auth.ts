export const MAX_AUTH_AGE_SECONDS = 5 * 60;

export function isRecentAuthentication(
  authTime: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof authTime !== "number" || !Number.isInteger(authTime)) return false;
  const age = nowSeconds - authTime;
  return age >= 0 && age <= MAX_AUTH_AGE_SECONDS;
}
