"use client";

import { useEffect } from "react";
import { reportUnexpectedError } from "@/lib/observability/report";

type ErrorFallbackProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

const ErrorFallback = ({ error, retry }: ErrorFallbackProps) => {
  useEffect(() => {
    reportUnexpectedError(error, { operation: "ui.render" });
  }, [error]);
  return (
    <main
      style={{
        margin: "4rem auto",
        padding: "2rem",
        maxWidth: "36rem",
        fontFamily: "system-ui",
      }}
    >
      <h1>Something went wrong</h1>
      <p>Please try again. If the problem continues, come back later.</p>
      <button onClick={retry}>Try again</button>
    </main>
  );
};

export { ErrorFallback };
export type { ErrorFallbackProps };
