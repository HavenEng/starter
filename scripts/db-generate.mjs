import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const usage =
  "Usage: pnpm db:generate --name <descriptive_snake_case_name> [--custom]";
const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(usage);
} else if (
  args[0] !== "--name" ||
  !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(args[1] ?? "") ||
  args.length < 2 ||
  args.length > 3 ||
  (args.length === 3 && args[2] !== "--custom")
) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const cli = fileURLToPath(
    new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url),
  );
  const child = spawn(process.execPath, [cli, "generate", ...args], {
    stdio: "inherit",
  });
  child.once("error", () => {
    console.error("Migration generation failed to start.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
