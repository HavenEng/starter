"use client";

import {
  ErrorFallback,
  type ErrorFallbackProps,
} from "@/components/error-fallback";

const GlobalError = (props: ErrorFallbackProps) => {
  return (
    <html lang="en">
      <body>
        <ErrorFallback {...props} />
      </body>
    </html>
  );
};

export default GlobalError;
