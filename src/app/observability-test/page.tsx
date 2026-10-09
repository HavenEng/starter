import { notFound } from "next/navigation";
import { isObservabilityTestEnabled } from "@/lib/observability/config";
import { ObservabilityFixture } from "./fixture";

const ObservabilityTest = async ({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) => {
  if (!isObservabilityTestEnabled()) notFound();
  if ((await searchParams).mode === "server") {
    throw new Error(
      "Observability server fixture user@example.com https://example.com/reset?oobCode=reset-secret",
    );
  }
  return <ObservabilityFixture />;
};

export default ObservabilityTest;
export const dynamic = "force-dynamic";
