// Shared between separately bundled route handlers and instrumentation. Weak keys
// keep failed requests from accumulating in a long-lived server process.
const globalForObservability = globalThis as typeof globalThis & {
  __observabilityErrorRequestIds?: WeakMap<object, string>;
};
const errorRequests = (globalForObservability.__observabilityErrorRequestIds ??=
  new WeakMap<object, string>());

export function setErrorRequestId(error: unknown, requestId: string) {
  if (typeof error === "object" && error !== null)
    errorRequests.set(error, requestId);
}

export function getErrorRequestId(error: unknown) {
  return typeof error === "object" && error !== null
    ? errorRequests.get(error)
    : undefined;
}
