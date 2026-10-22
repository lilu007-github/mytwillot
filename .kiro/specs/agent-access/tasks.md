# Implementation Plan: Agent Access (CLI / MCP)

## Tasks

- [x] 1. Shared mirror format
  - [x] 1.1 `packages/utils/agent-mirror.ts`: AgentTweet / folder / tag / meta /
    index types, `toAgentTweet`, `folderPathMap`, `buildAccountSnapshot`,
    `mergeAgentIndex`, mirror README — _Req 1.2, 1.5_
  - [x] 1.2 Unit tests (`agent-mirror.test.ts`)

- [x] 2. Extension writer
  - [x] 2.1 `x-bookmarks/src/libs/agent-mirror.ts`: pick/forget folder,
    `mirrorNow` (single-flight, hash skip, index merge), `autoMirror`,
    `startAutoMirror` — _Req 1.1, 1.3, 1.4, 1.6_
  - [x] 2.2 Export page section `components/AgentMirror.tsx`; start auto
    refresh from `Layout.tsx` after local data loads — _Req 1.1, 1.3, 1.6_
  - [x] 2.3 Tests with an in-memory directory handle (`agent-mirror.test.ts`)

- [x] 3. CLI package `packages/cli`
  - [x] 3.1 Loader + config (`data.ts`) — _Req 2.1_
  - [x] 3.2 Query language, filters, dedupe, sort, paging (`query.ts`) — _Req 2.2, 2.4_
  - [x] 3.3 Stats and trends (`trends.ts`) — _Req 2.3_
  - [x] 3.4 Commands and output formats (`cli.ts`, `format.ts`) — _Req 2.3, 2.5_
  - [x] 3.5 esbuild bundle → `dist/twillot.mjs`

- [x] 4. MCP server (`mcp.ts`) — tools, prompts, reload on change — _Req 3.1–3.4_

- [x] 5. Tests (query, trends, CLI, MCP via in-memory transport), CI steps,
  root format/typecheck, README

## Later

- Write-back (apply proposed folders/tags) via native messaging or an import
  file the extension reads.
