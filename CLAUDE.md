# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm monorepo of Manifest V3 Chrome extensions for X/Twitter power users. Three extensions share code from `packages/utils/`:

- **x-bookmarks** (main, active development): sync/search/organize/export bookmarks, AI tagging, folder management, follower/following grids. This is where nearly all work happens.
- **exporter**: one-click data export (followers, bookmarks).
- **x-bookmarks-automation**: engagement/content automation.
- **multi-publish**: multi-store publishing tooling (not a workspace member).
- **packages/cli** (`twillot-cli`): Node CLI + read-only MCP server that lets AI agents query the user's data via a local file mirror. See "Agent mirror" below; user guide in `docs/agent-access.md`.

All data lives locally in the browser (IndexedDB + `chrome.storage.local`). There is **no Twillot backend** — AI classification calls the user's own LLM provider directly with the user's own API key. There are no license tiers or export limits; don't add calls to `*.twillot.com` or other third-party relays (automation webhooks post straight to the user's endpoint from the background worker).

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

### Gates (CI)

`.github/workflows/ci.yml` runs on every push/PR; run the same locally before committing:

```bash
pnpm format:check   # root — prettier over all workspace source (pnpm format to fix)
pnpm typecheck      # root — tsc --noEmit for every workspace; must be 0 errors
# tests: packages/utils, x-bookmarks, exporter, x-bookmarks-automation, packages/cli (pnpm test -- --run in each)
# builds: x-bookmarks, exporter, x-bookmarks-automation, packages/cli (pnpm build in each)
```

`strict` is off, but `tsc` is a real gate now (it was cleaned to 0 errors) — don't reintroduce type errors. Vitest runs with `isolate: true`; keep it — with shared state, results depended on CPU count. When asked to commit, commit **and push** in the same step.

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

## Agent mirror (CLI / MCP)

IndexedDB isn't readable outside the browser, so the options page mirrors the active account's data as plain files into a folder the user picks (Export → "Agent access"), and `packages/cli` reads them. Three pieces, one format:

- **Format** — `packages/utils/agent-mirror.ts`: `AgentTweet`/`AgentFolder`/`AgentTag`/`AgentAccountMeta`/`AgentIndex`, `toAgentTweet`, `buildAccountSnapshot`, `mergeAgentIndex`, and `AGENT_README` (written into the mirror for agents). Layout: `index.json`, `README.md`, `accounts/<owner_id>/{tweets.jsonl,folders.json,tags.json,meta.json}`.
- **Writer** — `x-bookmarks/src/libs/agent-mirror.ts` (+ `components/AgentMirror.tsx`; auto-refresh started from `options/Layout.tsx`). Reuses the File System Access helpers in `libs/vault.ts` with its own handle key.
- **Reader** — `packages/cli/src`: `data.ts` (locate/load; `~/.config/twillot/config.json`), `query.ts` (query language, filters, dedupe, sort), `trends.ts` (stats, per-period terms via `Intl.Segmenter`, rising terms), `cli.ts`, `mcp.ts`. Bundled by esbuild into `dist/twillot.mjs` with `utils` inlined; only `@modelcontextprotocol/sdk` and `zod` stay external.

Rules:

- **Change the format only in `agent-mirror.ts`.** Adding a field is fine (readers ignore unknown fields). Renaming/removing a field or changing its type/meaning is breaking: bump `AGENT_MIRROR_SCHEMA` (the CLI refuses newer schemas). Either way update `AGENT_README`, `docs/agent-access.md` and `packages/cli/README.md`.
- To expose a new stored `Tweet` field to agents, map it in `toAgentTweet` and extend `agent-mirror.test.ts`.
- Write the mirror only from a window (options page), never the service worker: permission prompts need a window. Auto-refresh must only run when `queryPermission` is already `granted`; `requestPermission` only inside a click handler.
- Unchanged files are skipped by content hash; `meta.json`/`index.json` change every run on purpose (`exported_at` = freshness, surfaced by the `mirror_info` tool).
- The CLI/MCP is **read-only**. Write-back (applying AI-proposed folders/tags) is deferred (spec: `.kiro/specs/agent-access`, "Later"). New MCP tools must keep `readOnlyHint`; when adding one, update the exact tool list in `mcp.test.ts`, the tool tables in both docs, and the matching CLI command if any.
- Search across categories dedupes a tweet that is both bookmarked and liked (keeps the bookmark copy), except when a category filter is set. Trend counts are document frequency, not raw occurrences.
- CLI tests build mirrors with the real writer code (`src/fixture.test-helper.ts` → `buildAccountSnapshot`); keep it that way so writer and reader can't drift. `strict` is on in `packages/cli/tsconfig.json`.

## Shared package (`packages/utils/`)

Imported as `utils` (`"utils": "workspace:*"`), e.g. `import { StorageKeys } from 'utils/storage'`. Key areas: `api/` (Twitter GraphQL client, response/timeline/user parsers), `db/` (data access), `ai/classify.ts` (client-side LLM tagging — default model `claude-haiku-4-5-20251001`), `account-manager.ts` (multi-account registry). Within an extension, `~` aliases `./src`.

## Specs & workflow (`.kiro/`)

`.kiro/steering/` holds product/tech/structure/workflow guidance; `.kiro/specs/<feature>/` holds `requirements.md` + `design.md` + `tasks.md` per feature (multi-account-support, universal-folders, user-grid-view, agent-access). For medium/large features, update the relevant spec before/alongside implementation (see `.kiro/steering/workflow.md`); small changes (UI tweaks, bug fixes, copy) go straight to code. Conventional commits (`feat:`/`fix:`/`refactor:`/`docs:`).

`docs/req-res/` contains real captured Twitter GraphQL request/response samples — reference these when writing or debugging parsers.
