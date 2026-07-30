import { defineConfig } from "greenly";
import { checkVersion } from "./scripts/checks";

export default defineConfig({
  name: "greenly",
  checks: [
    { name: "Version", command: checkVersion },
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
    { name: "Lint", command: "pnpm oxlint" },
    { name: "Tests", command: "pnpm test" },
    { name: "Build", command: "pnpm build" },
  ],
});
