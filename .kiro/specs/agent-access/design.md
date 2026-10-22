# Design: Agent Access (CLI / MCP)

## Data flow

```
IndexedDB (posts/folders/tags, owner-scoped)
  └─ x-bookmarks options page: libs/agent-mirror.ts
       buildAccountSnapshot()  (packages/utils/agent-mirror.ts, pure)
       File System Access handle (stored in the twillot_vault IndexedDB,
       separate key from the Obsidian vault handle)
  └─ <mirror folder>/ index.json, README.md, accounts/<owner_id>/*
       └─ packages/cli (Node, read-only)
            data.ts   locate + load (config ~/.config/twillot/config.json)
            query.ts  filters, query language, dedupe, sort, paging
            trends.ts stats, per-period terms (Intl.Segmenter: zh + en),
                      hashtags, authors, rising terms
            cli.ts    commands (node:util parseArgs)
            sqlite.ts derived SQLite index (FTS5 + read-only SQL),
                      ~/.cache/twillot/<dir hash>/<owner_id>.sqlite
            mcp.ts    @modelcontextprotocol/sdk stdio server
```

## Decisions

- **Mirror, not a bridge.** Plain files work with Chrome closed and with any
  tool (jq, DuckDB, agents with file access). A live bridge (native
  messaging) is only needed for write-back; deferred.
- **One shared format module** (`utils/agent-mirror.ts`) used by both the
  extension writer and the CLI tests, so they cannot drift. The CLI bundles
  it with esbuild; npm deps (MCP SDK, zod) stay external.
- **Refresh in the options page**, not the service worker: File System Access
  permission prompts need a window. Auto-refresh only runs when permission is
  already granted.
- **Skip unchanged files** by content hash (fnv1a), like vault sync.
  `meta.json`/`index.json` change every run because `exported_at` records
  freshness for agents (`mirror_info`).
- **Trends use document frequency** (tweets mentioning a term), so one long
  thread can't dominate. Rising = latest period ≥ 2× the earlier per-period
  average, with at least 3 mentions.
- **Dedupe across categories** keeps the bookmark copy (it has folder/tags),
  except when a category filter is set.
- **SQLite as a derived index, not the store.** The browser can't usefully
  write a SQLite file other tools can read, and JSONL stays the interchange
  format. The CLI rebuilds the index from the mirror (keyed by file
  size/mtime, built to a temp file then renamed). Node's built-in
  `node:sqlite` avoids native dependencies.
- **Chinese full-text search:** FTS5 `unicode61` doesn't segment CJK, so both
  indexed text and queries go through `Intl.Segmenter` and each query term
  becomes a prefix phrase. Substring matching is kept as a recall fallback.
