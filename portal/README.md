# Apex Advantage Portal

React + Vite application for the Apex Advantage member portal and CRM.

The portal is the authenticated product surface for student dashboards, instructor/admin workflows, scheduling, billing, documents, ground school registration, analytics, messaging, endorsements, and future LMS features such as lessons, resources, quizzes, and progress tracking.

## Development Principles

Follow the repository-level `AGENTS.md`, `SourceofTruth.md`, and `PrivateCurriculum.md` guidance before making architectural or curriculum-adjacent changes.

Important constraints:

- Do not rewrite aviation lesson content unless explicitly instructed.
- Keep Apex branding aligned with the approved design system.
- Prefer small, reusable components over page-level duplication.
- Keep student-facing learning content data-driven rather than hardcoded into React components.

## Required Environment Variables

Create a local `.env` file in this `portal/` directory with:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

The app validates these variables during startup so missing configuration fails clearly.

## Local Development

Install dependencies from this directory:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Run lint:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Supabase Notes

Supabase CLI and Edge Function commands should be run from this `portal/` directory. Keep database migrations and Edge Function changes coordinated with the launch-readiness docs before deploying to production.

Manual production checks still matter for dashboard-managed items such as applied migrations, Edge Function secrets, lifecycle cron schedules, and Stripe webhook configuration.

## Deployment

This directory deploys independently as the portal Cloudflare Pages project. The expected production build command is:

```bash
npm run build
```

The build output directory is:

```bash
dist
```
