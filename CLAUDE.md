# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm monorepo of Manifest V3 Chrome extensions for X/Twitter power users. Three extensions share code from `packages/utils/`:

- **x-bookmarks** (main, active development): sync/search/organize/export bookmarks, AI tagging, folder management, follower/following grids. This is where nearly all work happens.
- **exporter**: one-click data export (followers, bookmarks).
- **x-bookmarks-automation**: engagement/content automation.
- **multi-publish**: multi-store publishing tooling (not a workspace member).

All data lives locally in the browser (IndexedDB + `chrome.storage.local`). There is **no Twillot backend** — AI classification calls the user's own LLM provider directly with the user's own API key.

## Commands

There is no root `test`/`build` script. Run commands from within a workspace directory (e.g. `cd x-bookmarks`):

```bash
pnpm install            # from repo root — installs all workspaces
cd x-bookmarks
pnpm dev                # Vite dev server + extension HMR (crxjs)
pnpm build              # production build → x-bookmarks/build/
pnpm test               # vitest (watch)
pnpm test -- --run      # vitest once (CI-style)
pnpm coverage           # vitest run --coverage
pnpm fmt                # prettier --write
pnpm zip                # build + package for Chrome Web Store
```

Run a single test file / test: `pnpm test -- --run gridLogic` or `pnpm test -- --run -t "cursor reconcile"`.

Shared-package tests: `cd packages/utils && pnpm test -- --run`. The root `vitest.workspace.json` scopes to `packages/*`, so running vitest at root covers only `packages/utils`.

### Build gate (important)

`strict` is **off** and there are ~10 pre-existing `tsc` errors across the repo — these are expected. **Do not use `tsc` as a pass/fail gate.** The real gate is `pnpm build` (Vite) succeeding. When asked to commit, commit **and push** in the same step.

## Code style

Prettier enforced (`.prettierrc`): single quotes, **no semicolons**, 2-space indent, trailing commas everywhere, 80-col. UI is **SolidJS, not React** (`jsxImportSource: solid-js`) — use Solid primitives (`createSignal`, `createStore`, `<For>`, `<Show>`), not React hooks/JSX conventions. Styling is TailwindCSS.

## Core architecture: passive GraphQL capture

The defining technique. Rather than issuing its own rate-limited Twitter API calls (and hitting the ~800-bookmark cap), the extension **passively intercepts the X web app's own GraphQL traffic** as the user browses:

1. **Page world** — `x-bookmarks/public/captureGraphql.js` is injected at `document_start` and monkey-patches `window.fetch` and `XMLHttpRequest`. For whitelisted operations (`Bookmarks`, `Likes`, `UserTweets`, `UserTweetsAndReplies`, `UserMedia`, `Followers`, `Following`, `BlueVerifiedFollowers`) it clones the response and `postMessage`s the JSON to the content script. This file is plain JS in `public/` (a web-accessible resource), **not** bundled TS.
2. **Content script** — `x-bookmarks/src/contentScript/index.ts` injects the page-world script, verifies `event.source === window` + origin, and forwards captures to the background via `chrome.runtime.sendMessage` (`TWILLOT_CAPTURED_TIMELINE` or `TWILLOT_CAPTURED_X_USER_LIST`).
3. **Background service worker** — `x-bookmarks/src/background/index.ts` validates the sender is a real `x.com` tab, parses payloads (`parseTimelineToRecords`, user parsers), and upserts into IndexedDB. It also uses `chrome.webRequest` to scrape live GraphQL **persisted-query IDs** and auth headers from the user's session (Twitter rotates these; hardcoded IDs eventually 404), so the extension's own direct API calls stay valid.

There are **two ingestion paths**: passive capture (above, opportunistic while browsing) and an active fetch loop (`src/options/sync-bookmarks.ts`, driven from the options page, uses captured query IDs + auth headers). Both write to the same stores.

Trust boundary: page world → content script (verify source+origin) → background (verify sender is an x.com tab). Preserve these checks when touching capture code.

## Data layer

- **IndexedDB** wrapper in `packages/utils/db/`. Current schema is `DB_VERSION = 24` in `db/index.ts`. Stores: `posts` (tweets, keyed `id`), `settings` (configs), `users`, `folders`, `tags` (plus legacy `tweets`/`configs` retained for migration). Schema changes go through `upgradeDb`/`createSchema`; migrations run **inside the `onupgradeneeded` transaction** — never open a new transaction there.
- **Owner-scoping is fundamental (multi-account).** Every record carries `owner_id` (the logged-in user's Twitter ID). Record IDs are composed like `getPostId(ownerId, tweetId)`; folder IDs via `getFolderId(ownerId, scope, name)`. Hot-path reads use compound indexes `owner_sort` / `owner_created` (`[owner_id, sort_index]`, `[owner_id, created_at]`) to range-scan one account instead of scanning the whole store. When adding queries, scope by `owner_id` and prefer these indexes.
- **`chrome.storage.local`** for settings/cursors/sync state, also per-account namespaced: `getStorageKey(key, userId)` → `user:{userId}:{key}` (see `packages/utils/storage.ts`). `current_user_id` is the one un-namespaced key. Changing `current_user_id` (account switch) triggers background logic that cancels the old sync and starts a full sync for the new account.

## Sync state

`packages/utils/sync-engine.ts` owns sync **status** (idle/syncing/error, progress, cursor) in `chrome.storage.local`, per account. The actual fetch loop lives in `x-bookmarks/src/options/sync-bookmarks.ts` and reports progress back via `updateSyncProgress`/`finishSync`. `src/options/handlers.ts` is a barrel re-exporting `query.ts` (read/pagination), `sync-bookmarks.ts` (sync/reconcile/threads/delete), and `ai-actions.ts` (AI batch runs).

## Shared package (`packages/utils/`)

Imported as `utils` (`"utils": "workspace:*"`), e.g. `import { StorageKeys } from 'utils/storage'`. Key areas: `api/` (Twitter GraphQL client, response/timeline/user parsers), `db/` (data access), `ai/classify.ts` (client-side LLM tagging — default model `claude-haiku-4-5-20251001`), `account-manager.ts` (multi-account registry). Within an extension, `~` aliases `./src`.

## Specs & workflow (`.kiro/`)

`.kiro/steering/` holds product/tech/structure/workflow guidance; `.kiro/specs/<feature>/` holds `requirements.md` + `design.md` + `tasks.md` per feature (multi-account-support, universal-folders, user-grid-view). For medium/large features, update the relevant spec before/alongside implementation (see `.kiro/steering/workflow.md`); small changes (UI tweaks, bug fixes, copy) go straight to code. Conventional commits (`feat:`/`fix:`/`refactor:`/`docs:`).

`docs/req-res/` contains real captured Twitter GraphQL request/response samples — reference these when writing or debugging parsers.
