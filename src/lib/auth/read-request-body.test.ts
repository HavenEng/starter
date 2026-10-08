// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { readRequestBody, RequestBodyTooLargeError } from "./read-request-body";

vi.mock("server-only", () => ({}));

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers?: HeadersInit,
) {
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readRequestBody", () => {
  it("reads a multibyte character split across chunks at the byte limit", async () => {
    const bytes = new TextEncoder().encode("😊");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 2));
        controller.enqueue(bytes.subarray(2));
        controller.close();
      },
    });

    await expect(readRequestBody(streamRequest(stream), 4)).resolves.toBe("😊");
    expect(stream.locked).toBe(false);
  });

  it("rejects an oversized unfinished stream without waiting for cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_000));
        controller.enqueue(new Uint8Array(4_001));
        // The sender never closes this stream.
      },
      cancel,
    });

    await expect(
      readRequestBody(streamRequest(stream), 12_000),
    ).rejects.toThrow(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("counts encoded bytes rather than decoded characters", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("😊"));
      },
      cancel,
    });

    await expect(readRequestBody(streamRequest(stream), 3)).rejects.toThrow(
      RequestBodyTooLargeError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an oversized declared length before reading", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );

    await expect(
      readRequestBody(
        streamRequest(stream, { "Content-Length": "12001" }),
        12_000,
      ),
    ).rejects.toThrow(RequestBodyTooLargeError);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("checks actual bytes even when the declared length is too small", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12_001));
      },
    });

    await expect(
      readRequestBody(streamRequest(stream, { "Content-Length": "1" }), 12_000),
    ).rejects.toThrow(RequestBodyTooLargeError);
  });

  it("releases the reader if the stream fails", async () => {
    const failure = new Error("Disconnected");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });

    await expect(readRequestBody(streamRequest(stream), 12_000)).rejects.toBe(
      failure,
    );
    expect(stream.locked).toBe(false);
  });

  it("handles a missing body", async () => {
    await expect(
      readRequestBody(
        new Request("http://localhost", { method: "POST" }),
        12_000,
      ),
    ).resolves.toBe("");
  });
});
