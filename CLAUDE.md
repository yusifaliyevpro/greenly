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

- `src/cli.ts` - bin entry (shebang). Parses flags, loads config, runs checks, sets exit code. Also
  kicks off a non-blocking npm update check (TTY only) and prints an "update available" notice at the end.
- `src/index.ts` - library entry. Re-exports `defineConfig` and the public types.
- `src/lib/types.ts` - `GreenlyConfig`, `GreenlyCheck`, `OnFailContext`, `OnFailFn` (JSDoc every field).
- `src/lib/define-config.ts` - `defineConfig` (identity, for inference).
- `src/lib/config.ts` - `loadGreenlyConfig` via `jiti` (zero-dep runtime TS loader); `findConfigFile`; `ConfigNotFoundError` / `ConfigInvalidError`.
- `src/lib/runner.ts` - `runChecks`: the sequential runner + banner + summary.
- `src/lib/args.ts` - `parseArgs` / `resolveMode` (pure, unit-tested).
- `src/lib/colors.ts` - tiny zero-dep ANSI helper (respects `NO_COLOR` / TTY).
- `src/lib/utils.ts` - package-manager helpers shared by `cli.ts` and `init.ts`: `PackageManager`,
  `detectPackageManager`, `detectLockfiles`, `installCommand` (the "install latest" / update command).
- `src/lib/version.ts` - version helpers: `compareVersions` / `isNewer` (pure), `fetchLatestVersion`
  and `checkForUpdate` (best-effort npm lookup that never throws, times out, and returns `null` on any
  failure so the CLI stays silent offline).
- `src/lib/init.ts` - `greenly init` scaffolder. Pure helpers (`buildChecks`, `renderConfig`,
  `withCheckScript`, `CHECK_PRESETS`, `greenlyLocation`, `declaredGreenlyVersion`, `shouldOfferInstall`)
  are unit-tested; `runInit` is the clack-driven orchestrator. `cli.ts` routes `argv[0] === "init"` to it.
  Each entry in `CHECK_PRESETS` is offered independently: a `detect(deps)` predicate gates it on the
  installed dependencies (usually a single dep via the `dep()` helper), so competing tools are never
  paired, only whichever is actually in package.json is shown. Presets without `detect` are always
  offered (e.g. Build). Add a new built-in check (expo-doctor, a custom doctor script) by appending an
  entry with its own `detect` and `build`. The install step is skipped when greenly is already a
  devDependency at the latest version (compared against the range declared in the root package.json,
  never node_modules); a prod-`dependencies` placement or an outdated/undeterminable version re-prompts.

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

- `command` is a raw shell string (no package-manager prefixing), OR a function
  (`() => void | Promise<void>`) run in-process that must throw/reject to fail.
- `onFail` is `string | (ctx) => void | Promise<void>`; prompted Yes/No before running.
- `optional: true` warns on failure but never fails the overall run.
- The repo dogfoods itself via its own `greenly.config.ts`; that `import "greenly"` resolves through
  the package's own `exports` (Node self-referencing) after a build.
- `greenly.config.ts` stays minimal (only the `defineConfig` export). Custom function checks live in
  `scripts/` (e.g. `scripts/checks.ts` exports `checkVersion`) and are imported into the config.

## Runner behavior (important details)

- Commands run with `stdio: ["inherit", "inherit", "pipe"]` - stdout streams live, **stderr is
  buffered and only printed on failure**. This is deliberate: it hides the package manager's own
  `$ <script>` echo (e.g. `$ vitest run`) which goes to stderr. Do not switch to full `"inherit"`.
- Output style mirrors the original `pr-checks.ts` (bold cyan banner, `> name`, `$ cmd`,
  `PASSED` / `FAILED`, separators, `Results:` summary), rendered with plain `console.log`.
- `@clack/prompts` is used **only** for the interactive Yes/No fix `confirm` (default yes).
- Non-interactive by default when `process.stdout.isTTY` is false (CI/agents never hang).

## CLI

`greenly` runs the checks. `greenly init` scaffolds a config interactively.
Flags: `-y` / `--yes` / `--fix` (auto-run fixers), `--no-fix` (report only), `-v`/`--version`, `-h`/`--help`.

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
