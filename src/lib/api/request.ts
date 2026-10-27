import type { NextRequest } from "next/server";
import {
  readRequestBody,
  RequestBodyTooLargeError,
} from "@/lib/auth/read-request-body";
import { ApplicationError, errors } from "./application-error";

export function requireSameOrigin(request: NextRequest) {
  const expected = new URL(request.nextUrl.origin);
  const host = request.headers.get("host");
  if (!host) throw errors.forbidden();
  expected.host = host;
  if (request.headers.get("origin") !== expected.origin)
    throw errors.forbidden();
}

export async function readJson(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  ) {
    throw new ApplicationError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "Expected a JSON request.",
    );
  }
  try {
    const value: unknown = JSON.parse(await readRequestBody(request, 12_000));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw errors.invalid();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof RequestBodyTooLargeError)
      throw new ApplicationError(
        "BODY_TOO_LARGE",
        413,
        "Request is too large.",
      );
    throw errors.invalid("Invalid JSON request.");
  }
}

export function requireUuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw errors.invalid();
  return value;
}
