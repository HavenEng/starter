export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "ApplicationError";
  }
}

export const errors = {
  invalid: (message = "Invalid request.") =>
    new ApplicationError("INVALID_INPUT", 400, message),
  unauthenticated: () =>
    new ApplicationError("UNAUTHENTICATED", 401, "Please sign in."),
  forbidden: () => new ApplicationError("FORBIDDEN", 403, "Access denied."),
  missing: () => new ApplicationError("NOT_FOUND", 404, "Resource not found."),
  conflict: (message: string) => new ApplicationError("CONFLICT", 409, message),
  limited: () =>
    new ApplicationError("TOO_MANY_REQUESTS", 429, "Too many requests"),
  unavailable: (cause?: unknown) =>
    new ApplicationError(
      "SERVICE_UNAVAILABLE",
      503,
      "Service unavailable. Please try again.",
      { cause },
    ),
};
