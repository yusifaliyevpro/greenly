import { defineConfig } from "greenly";
import { checkVersion } from "./scripts/version";

export default defineConfig({
  name: "greenly",
  checks: [
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
    { name: "Lint", command: "pnpm oxlint" },
    { name: "Tests", command: "pnpm test" },
    { name: "Build", command: "pnpm build" },
    { name: "Version", command: checkVersion },
  ],
});
