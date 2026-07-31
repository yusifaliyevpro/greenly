# greenly

> Config-driven project check runner. Define your lint / format / typecheck / test steps once in `greenly.config.ts` and run them with a single command.

Stop copy-pasting a `pr-checks` script into every repo. Describe your checks in a typed config, and `greenly` runs them in order, streams their output, and offers to auto-fix the ones that can be fixed.

## Quick start

The fastest way to get going is the interactive scaffolder. It asks for a project
name, config format, script name, and which checks to include, then writes the config,
adds a `"check": "greenly"` script, and installs greenly:

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

| Command / Flag         | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `greenly`              | Run the checks from `greenly.config.*`.                                            |
| `greenly init`         | Scaffold a config interactively (format, script name, checks) and install greenly. |
| `-y`, `--yes`, `--fix` | Auto-run every `onFail` fixer without prompting (great for CI / agents).           |
| `--no-fix`             | Run all checks, never prompt or fix, just report.                                  |
| `-v`, `--version`      | Print the version.                                                                 |
| `-h`, `--help`         | Show help.                                                                         |

When stdout is **not a TTY** (CI, piped output), greenly is non-interactive by default, so it never prompts and nothing hangs. Use `--yes` there to auto-apply fixes.

## License

MIT © [Yusif Aliyev](https://yusifaliyevpro.com)
