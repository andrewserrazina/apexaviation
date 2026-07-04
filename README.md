# Apex Aviation

Monorepo combining the two apps that used to live in separate repos
(`apexaviation` and `apexadvantage`), merged for easier cross-repo changes.

- **`site/`** — the marketing site (static HTML/CSS/JS, deployed as-is,
  no build step). Formerly the `apexaviation` repo.
- **`portal/`** — the Apex Advantage member portal / CRM (React + Vite,
  Supabase backend). Formerly the `apexadvantage` repo.

Each folder deploys as its own Cloudflare Pages project — set that
project's "Root directory" build setting to `site` or `portal`
respectively. Build settings otherwise stay whatever they already were
(no build command for `site/`; `npm run build` → `dist/` for `portal/`).

Supabase CLI commands for the portal (e.g. `supabase functions deploy`)
should be run from inside `portal/`.
