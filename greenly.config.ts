import { defineConfig } from "greenly";
import { checkVersion } from "./scripts/version";

export default defineConfig({
  name: "greenly",
  checks: [
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Oxfmt", command: "pnpm fmt:check", onFail: "pnpm fmt" },
    { name: "Oxlint", command: "pnpm lint" },
    { name: "Tests", command: "pnpm test" },
    { name: "Build", command: "pnpm build" },
    { name: "Version", command: checkVersion },
  ],
});
