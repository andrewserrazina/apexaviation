# Apex Aviation Design System — sync notes

## Repo layout
- The design system lives in `design-system/` (a new package, sibling to
  `site/` and `portal/`) — it did not exist before this sync; it was built
  specifically to give this sync something real to import. Brand tokens
  (colors, fonts, radii, shadows) were copied verbatim from `site/styles.css`'s
  `:root` block and `site/portal.css`, not reinterpreted.
- `buildCmd`: `npm run build --prefix design-system` (Vite library build +
  `tsc --emitDeclarationOnly`).
- Storybook config lives at `design-system/.storybook` — pass that full
  path as `storybookConfigDir`/`-c`, not just `design-system`.

## Fixes applied this sync
- `[GENERAL]` Vite 8 isn't yet supported by `@storybook/react-vite`'s peer
  range (`^5||^6||^7`), and `@vitejs/plugin-react` v6 requires Vite 8 —
  pinned `vite` to `^7.0.0` and `@vitejs/plugin-react` to `^5.0.0` in
  `design-system/package.json` to satisfy both.
- CSS `@import` rules were preceded by a bare `box-sizing` reset rule in
  `src/styles.css`, which Vite/PostCSS rejects (`@import must precede all
  other statements`) — moved the reset after the imports.
- `cssEntry` needed to be package-relative (`dist/apex-design-system.css`),
  not repo-root-relative — the converter resolves it from the package dir
  (same dir as `--node-modules`).
- `[FONT_MISSING]` Montserrat + Playfair Display aren't shipped as files
  anywhere in the repo (the real site loads them via Google Fonts `<link>`
  tags) — fetched the actual `.woff2` files from `fonts.gstatic.com`
  (network egress works in this environment) and vendored them at
  `design-system/fonts/fonts.css` + `.woff2`, wired via `cfg.extraFonts`.
  **Caveat**: the Google Fonts CSS2 API served the *same* underlying
  Montserrat file for all five requested weights (400/500/600/700/800) in
  this fetch — real weight differentiation may not be present in the
  vendored file (declared as a `font-weight: 400 800` range to reflect
  this honestly rather than falsely claiming discrete weights). Worth
  re-fetching from a different network path if per-weight fidelity ever
  matters more than it does today.
- `[GRID_OVERFLOW]` on `Button` (Outline story renders wider than its grid
  cell) and `Modal` (fixed-position overlay escapes any cell) — fixed via
  `cfg.overrides`: `Button: {"cardMode": "column"}`, `Modal:
  {"cardMode": "single", "primaryStory": "UnlockCheckridePrep"}`.
- Playwright's browser download is blocked by this sandbox's network
  policy (`cdn.playwright.dev` returns 403) — used the pre-installed
  Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` via
  `DS_CHROMIUM_PATH`. **This env var does not persist across separate
  shell invocations in this environment** — it must be set inline with
  every command that launches a browser (`package-validate.mjs`,
  `compare.mjs`), not exported once and reused.

## Re-sync risks
- The Montserrat weight-collapse above (all weights → one file) was
  observed once, from this specific sandboxed network path. If a re-sync
  from a different machine/network fetches genuinely distinct per-weight
  files, that's an improvement, not a regression — no action needed either
  way, but don't be surprised if the vendored fonts differ across syncs.
- `design-system/` has no components beyond the initial 18 — this was a
  from-scratch build, not an extraction of an existing library, so there
  is no upstream repo whose changes could drift this sync out of sync.
  Future component additions to `design-system/` are the only thing that
  would move `_ds_sync.json`'s render hashes.
- No theme/provider system exists in this DS (no context, no `cfg.provider`
  needed) — if one is added later, revisit the "theme/provider-sensitive"
  solo-phase pick (skipped this sync since nothing applicable existed).
