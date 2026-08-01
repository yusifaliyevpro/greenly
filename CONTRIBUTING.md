# Contributing to greenly

Thanks for taking the time to contribute. Bug reports, feature ideas, and pull requests
are all welcome.

## Found a problem?

- **Something is broken:** open a [bug report](https://github.com/yusifaliyevpro/greenly/issues/new?template=bug_report.yml).
  Include your greenly version, package manager, OS, your `greenly.config.*`, and the exact
  output you got versus what you expected.
- **You have an idea:** open a [feature request](https://github.com/yusifaliyevpro/greenly/issues/new?template=feature_request.yml)
  and describe the problem it solves, not just the solution.

Please search existing issues first so we can keep the discussion in one place. For a small,
obvious fix (a typo, a broken link, a one-line bug) feel free to skip straight to a pull
request.

## Development setup

greenly uses [pnpm](https://pnpm.io). Fork and clone the repo, then:

```bash
pnpm install
```

Common commands:

```bash
pnpm build         # bundle the library + bin with tsdown (writes dist/)
pnpm test          # run the vitest suite
pnpm lint          # oxlint
pnpm fmt           # oxfmt (formats in place)
pnpm tsc --noEmit  # typecheck
pnpm check         # run greenly on itself (needs a build first)
```

greenly dogfoods itself: `pnpm check` runs the checks defined in this repo's own
`greenly.config.ts`. Because it runs `node dist/cli.js`, run `pnpm build` before
`pnpm check` if you have changed the source.

## Making a change

1. Create a branch off `main`.
2. Make your change, and add or update tests for it. New behavior should come with a test.
3. Run `pnpm build && pnpm check` and make sure everything is green.
4. Open a pull request and fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).

## Conventions

Keep changes consistent with the surrounding code:

- **Extensionless** relative imports (no `.ts` suffix); the bundler and vitest resolve them.
- Prefer `type` over `interface` unless you need an interface-only feature.
- Dependency versions are **exact-pinned** (no `^` / `~`); pnpm is configured with
  `saveExact`.
- Match the existing output style and test style. Runner tests silence `console.log` and
  `process.stderr.write` so the report stays clean.

## Reporting security issues

Please do not open a public issue for a security problem. Email the maintainer instead at
[yusifaliyevpro@gmail.com](mailto:yusifaliyevpro@gmail.com) so it can be handled privately.
