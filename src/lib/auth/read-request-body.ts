import "server-only";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readRequestBody(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    void request.body?.cancel().catch(() => {});
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return "";
  }

  const bytes = new Uint8Array(maxBytes);
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return new TextDecoder().decode(bytes.subarray(0, bytesRead));
      }

      if (bytesRead + value.byteLength > maxBytes) {
        // Reject immediately even if the underlying stream's cancellation stalls.
        void reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }

      bytes.set(value, bytesRead);
      bytesRead += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}
