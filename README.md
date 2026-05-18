# GSO

Operating layer for solo AI founders, riding Paperclip primitives. The v0 product surface is three things:

- **Org Canvas** — visual, editable org chart. Drag to reassign work.
- **Triage Inbox** — single inbox for board/user requests; auto-routes to the right agent role.
- **Budget & Governance Dashboard** — burn vs. plan per agent, approval queue, monthly close.

## Stack

| Concern       | Choice                                         |
| ------------- | ---------------------------------------------- |
| Language      | TypeScript (strict)                            |
| Framework     | [Next.js 15](https://nextjs.org/) (App Router) |
| Lint / format | ESLint (`next/core-web-vitals`) + Prettier     |
| Tests         | [Vitest](https://vitest.dev/) + jsdom          |
| Pre-commit    | husky + lint-staged                            |
| CI            | GitHub Actions — lint, typecheck, test, build  |
| Deploy        | [Vercel](https://vercel.com/) (Next.js preset) |

Why these: Next.js gives us SSR for the read-heavy Paperclip surfaces and one-click deploys to Vercel. Vitest is the lightest TS-native test runner that survives a frontend + node-runtime mix. Everything here is a two-way door — no DB, no auth framework, no Paperclip wrapper yet (those land in [GSO-21](../../issues/GSO-21) and [GSO-28](../../issues/GSO-28)).

## Requirements

- Node `>= 22`
- npm `>= 10`

## Run commands

```bash
npm install          # install deps + activate husky pre-commit
npm run dev          # next dev — http://localhost:3000
npm run build        # production build
npm start            # serve the production build

npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest (CI runs `vitest run`)
npm run format       # prettier --check .
npm run format:write # prettier --write .
```

## Trivial route

`GET /api/healthz` returns:

```json
{
  "status": "ok",
  "service": "gso",
  "version": "0.1.0",
  "commit": "dev",
  "uptimeSeconds": 12,
  "timestamp": "2026-05-18T00:00:00.000Z"
}
```

`commit` precedence: `GSO_COMMIT` → `VERCEL_GIT_COMMIT_SHA` (set automatically by Vercel) → `GIT_COMMIT_SHA` (set by CI from `github.sha`) → `dev` (local). SHA is truncated to 7 chars.

## CI

`.github/workflows/ci.yml` runs on push and PR to `main`:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run format` (Prettier check)
6. `npm run build`

A passing badge will be added once the GitHub remote and the `main` branch exist.

## Deploy path

The repo is Vercel-ready out of the box.

1. Create the GitHub repo at `github.com/<owner>/gso` and push `main`.
2. In Vercel, **Import Project** → select the GitHub repo. Vercel auto-detects Next.js; no overrides required (`vercel.json` is included for explicitness).
3. Set any environment variables from `.env.example` — none are required for the `/api/healthz` route to work.
4. Production URL: `https://gso.vercel.app` (or a custom domain when assigned).

Rollback: redeploy a previous deployment from the Vercel dashboard, or `git revert` and push.

## Pre-commit

`npm install` runs `husky` which installs the `.husky/pre-commit` hook. The hook runs `lint-staged`, which Prettier-formats and ESLint-fixes staged files.

## Repo layout

```
app/
  layout.tsx
  page.tsx
  api/healthz/route.ts
lib/
  health.ts
tests/
  health.test.ts
.github/workflows/ci.yml
.husky/pre-commit
```
