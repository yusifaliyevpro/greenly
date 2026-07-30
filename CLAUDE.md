# CLAUDE.md

Guidance for working in this repo.

## What this is

`greenly` is a public npm CLI (name owned by `yusifaliyevpros`) that runs project checks
(lint / format / typecheck / test / build) defined in a `greenly.config.*` file. It replaces a
hand-copied `scripts/pr-checks.ts` that had drifted across the author's projects (`filmisbest`,
`yusifaliyevpro`, `az-git-community/website`). Run it with `pnpm greenly`, or wire `"check": "greenly"`
and run `pnpm check`.

The package exposes **both**:

- a **bin** (`greenly` -> `dist/cli.js`), and
- a **library export** (`import { defineConfig } from "greenly"`).

## Source layout

Only `index.ts` and `cli.ts` live at the root of `src/`; everything else is in `src/lib/`.

- `src/cli.ts` - bin entry (shebang). Parses flags, loads config, runs checks, sets exit code.
- `src/index.ts` - library entry. Re-exports `defineConfig` and the public types.
- `src/lib/types.ts` - `GreenlyConfig`, `GreenlyCheck`, `OnFailContext`, `OnFailFn` (JSDoc every field).
- `src/lib/define-config.ts` - `defineConfig` (identity, for inference).
- `src/lib/config.ts` - `loadGreenlyConfig` via `c12`; `findConfigFile`; `ConfigNotFoundError` / `ConfigInvalidError`.
- `src/lib/runner.ts` - `runChecks`: the sequential runner + banner + summary.
- `src/lib/args.ts` - `parseArgs` / `resolveMode` (pure, unit-tested).
- `src/lib/colors.ts` - tiny zero-dep ANSI helper (respects `NO_COLOR` / TTY).

## Config

`greenly.config.{ts,js,mts,mjs,cts,cjs,json}`, discovered in the cwd. Authored with `defineConfig`:

```ts
import { defineConfig } from "greenly";

export default defineConfig({
  name: "MyProject", // shown centered in the banner; rules widen for long names
  checks: [
    { name: "TypeScript", command: "pnpm tsc --noEmit" },
    { name: "Format", command: "pnpm oxfmt --check", onFail: "pnpm oxfmt" },
    { name: "Lint", command: "pnpm oxlint" },
    { name: "Build", command: "pnpm build", optional: true }, // failure warns, no exit 1
  ],
});
```

- `command` is a raw shell string the user writes (no package-manager prefixing).
- `onFail` is `string | (ctx) => void | Promise<void>`; prompted Yes/No before running.
- `optional: true` warns on failure but never fails the overall run.
- The repo dogfoods itself via its own `greenly.config.ts`; that `import "greenly"` resolves through
  the package's own `exports` (Node self-referencing) after a build.

## Runner behavior (important details)

- Commands run with `stdio: ["inherit", "inherit", "pipe"]` - stdout streams live, **stderr is
  buffered and only printed on failure**. This is deliberate: it hides the package manager's own
  `$ <script>` echo (e.g. `$ vitest run`) which goes to stderr. Do not switch to full `"inherit"`.
- Output style mirrors the original `pr-checks.ts` (bold cyan banner, `> name`, `$ cmd`,
  `PASSED` / `FAILED`, separators, `Results:` summary), rendered with plain `console.log`.
- `@clack/prompts` is used **only** for the interactive Yes/No fix `confirm` (default yes).
- Non-interactive by default when `process.stdout.isTTY` is false (CI/agents never hang).

## CLI flags

`-y` / `--yes` / `--fix` (auto-run fixers), `--no-fix` (report only), `-v`/`--version`, `-h`/`--help`.

## Commands

```bash
pnpm build        # tsdown: dual ESM/CJS library + single-file ESM bin (dist/cli.js)
pnpm test         # vitest run
pnpm check        # dogfood greenly on itself (node dist/cli.js; needs a build first) - Run it directly to check all.
pnpm fmt          # oxfmt
pnpm lint         # oxlint
pnpm tsc --noEmit # typecheck
```

## Conventions

- **No em-dashes** anywhere (comments, output strings, README). Use commas/periods. `--flag` is fine.
- **Extensionless** relative imports (no `.ts` suffix); `allowImportingTsExtensions` is intentionally
  off - tsdown/rolldown/vitest resolve them.
- Exact-pinned dependency versions (pnpm `saveExact` in `pnpm-workspace.yaml`).
- Tooling mirrors the author's `ripen` / `countries` packages: tsdown, vitest, oxlint/oxfmt,
  `.npmrc` provenance, GitHub Actions (PR checks + version-diff publish).
- Runner tests silence `console.log` / `process.stderr.write` in `beforeEach` so the report stays clean.

## Publishing

Bump `version` in `package.json` and push to `main`. The `publish.yml` workflow gates on
version-vs-latest-tag, then builds, `npm publish --access public` (provenance via `id-token: write`),
tags, and creates a GitHub release. Current npm version is the `0.0.1` "Coming soon" placeholder.
