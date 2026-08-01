<h1>
  <img src="https://raw.githubusercontent.com/yusifaliyevpro/greenly/main/assets/greenly.svg" alt="" height="34" align="top" />
  greenly
</h1>

[![npm version](https://img.shields.io/npm/v/greenly?color=3fb950&label=npm)](https://www.npmjs.com/package/greenly)
[![npm downloads](https://img.shields.io/npm/dm/greenly?color=3fb950)](https://www.npmjs.com/package/greenly)
[![unpacked size](https://img.shields.io/npm/unpacked-size/greenly?color=3fb950)](https://www.npmjs.com/package/greenly)
[![Socket Badge](https://badge.socket.dev/npm/package/greenly/1.0.1)](https://socket.dev/npm/package/greenly)
[![PR Checks](https://github.com/yusifaliyevpro/greenly/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/yusifaliyevpro/greenly/actions/workflows/pr-checks.yml)
[![license](https://img.shields.io/npm/l/greenly?color=3fb950)](https://github.com/yusifaliyevpro/greenly/blob/main/LICENSE)

> Config-driven project check runner. Define your lint / format / typecheck / test / custom steps once in `greenly.config.ts` and run them with a single command.

## Why greenly

**greenly runs all your lint, format, typecheck, test, build, and custom checks from one config file with a single command.**

Instead of pushing and waiting for CI to catch a formatting slip or a type error, run
`pnpm greenly` before you open a PR. It puts your CI checks and local checks in the same
place, so if everything is green locally, it is green in CI. Checks run in order with
their output streamed live, and greenly offers to auto-fix the ones that have a fixer.

It works where your tools do. In an interactive terminal greenly prompts before running a
fixer; in an **agent terminal or CI (non-TTY)** it skips prompts and just reports pass or
fail, so it never hangs and an agent can run `greenly` directly.

## Quick start

Run this and greenly sets everything up for you, based on the tools your project already uses:

```bash
pnpx greenly init
# or: npx greenly init
```

## Install

Or set it up manually:

```bash
pnpm add -D greenly
```

Create a `greenly.config.ts` at your project root:

```ts
import { defineConfig } from "greenly";

export default defineConfig({
  name: "MyProject",
  checks: [
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
    { name: "Lint", command: "pnpm oxlint" },
    { name: "Build", command: "pnpm build", optional: true },
  ],
});
```

Run it:

```bash
pnpm greenly
```

Or wire it into your scripts so `pnpm check` works too:

```json
{
  "scripts": {
    "check": "greenly"
  }
}
```

## How it works

- Checks run **in order**. Each `command` runs in your shell with its output streamed live, so failures show up immediately.
- If a check fails and declares an `onFail`, greenly asks **Yes/No** whether to run the fixer, then continues.
- Checks marked `optional: true` warn on failure but never fail the overall run.
- greenly exits with code `1` if any non-optional check is still failing, otherwise `0`.

## Use it in CI

The same command you run locally is the command CI runs. Replace your separate check
steps with one:

```diff
       - run: pnpm install --frozen-lockfile

-      - name: TypeScript
-        run: pnpm tsc --noEmit
-
-      - name: Oxfmt
-        run: pnpm fmt:check
-
-      - name: Oxlint
-        run: pnpm lint
-
-      - name: Tests
-        run: pnpm test
-
-      - name: Build
-        run: pnpm build
-
-      - name: Version
-        run: node --no-warnings scripts/version-check.ts
-
+      # pnpm greenly
+      - name: Run checks
+        run: pnpm check
```

## Config reference

| Field               | Type                                       | Description                                                               |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `name`              | `string?`                                  | Project name shown in the banner.                                         |
| `checks`            | `Check[]`                                  | Ordered list of checks.                                                   |
| `checks[].name`     | `string`                                   | Label shown while running and in the summary.                             |
| `checks[].command`  | `string \| () => void \| Promise<void>`    | Shell command (e.g. `"pnpm tsc --noEmit"`), or a function run in-process. |
| `checks[].onFail`   | `string \| (ctx) => void \| Promise<void>` | Fixer run (after a Yes/No prompt) when the check fails.                   |
| `checks[].optional` | `boolean?`                                 | When `true`, a failure warns instead of failing the run.                  |

`command` can be a function instead of a shell string. It may be async, and it must **throw** (or reject) to mark the check as failed. When it throws, greenly prints only the error's `message` (and its `cause` if present) - not a stack trace - so make the message descriptive:

```ts
export default defineConfig({
  checks: [
    {
      name: "Env vars",
      command: () => {
        if (!process.env.API_KEY) throw new Error("API_KEY is not set");
      },
    },
  ],
});
```

`onFail` can also be a function, useful for custom fix logic:

```ts
export default defineConfig({
  checks: [
    {
      name: "Generated files",
      command: "pnpm verify:generated",
      onFail: async ({ check }) => {
        await regenerate();
        console.log(`Regenerated files for ${check.name}`);
      },
    },
  ],
});
```

### Config file formats

Any of these are auto-discovered (first match wins, in this order):

```
greenly.config.ts   greenly.config.mts   greenly.config.cts
greenly.config.js   greenly.config.mjs   greenly.config.cjs
greenly.config.json
```

## CLI

| Command / Flag         | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `greenly`              | Run the checks from `greenly.config.*`.                                  |
| `greenly init`         | Set up a config by answering a few questions, then install greenly.      |
| `-y`, `--yes`, `--fix` | Auto-run every `onFail` fixer without prompting (great for CI / agents). |
| `--no-fix`             | Run all checks, never prompt or fix, just report.                        |
| `-v`, `--version`      | Print the version.                                                       |
| `-h`, `--help`         | Show help.                                                               |

When stdout is **not a TTY** (CI, piped output), greenly is non-interactive by default, so it never prompts and nothing hangs. Use `--yes` there to auto-apply fixes.

## License

MIT © [Yusif Aliyev](https://yusifaliyevpro.com)
