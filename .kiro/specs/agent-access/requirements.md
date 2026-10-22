# Requirements: Agent Access (CLI / MCP)

## Introduction

Users want AI agents and scripts to use their saved X data for research,
summaries, organizing and spotting trends. The data lives in the extension's
IndexedDB, which nothing outside the browser can read. This feature mirrors it
to plain files and adds a read-only CLI and MCP server over that mirror.

## Requirements

### 1. Data mirror

**User Story:** As a user, I want my bookmarks, likes and posts written to a
local folder I choose, so tools outside the browser can read them.

1. WHEN the user chooses a mirror folder in Export → "Agent access" THEN the
   extension SHALL write the current account's data there immediately.
2. The mirror SHALL contain `index.json`, `README.md` and, per account,
   `tweets.jsonl`, `folders.json`, `tags.json`, `meta.json` in the format of
   `packages/utils/agent-mirror.ts` (versioned by `AGENT_MIRROR_SCHEMA`).
3. WHILE the options page is open and folder permission is granted, the mirror
   SHALL refresh on page load and every 15 minutes without prompting.
4. Unchanged files SHALL NOT be rewritten.
5. Mirroring account A SHALL keep other accounts' entries in `index.json`.
6. IF permission was revoked THEN auto-refresh SHALL skip silently and the UI
   SHALL show a reconnect hint.

### 2. CLI

**User Story:** As a user, I want to search and analyze my saved tweets from
the terminal.

1. `twillot init <dir>` SHALL remember the mirror folder; `--data` and
   `$TWILLOT_DATA` SHALL override it.
2. `search` SHALL support terms (all must match), "phrases", `-exclusions`,
   `from:`, `since:`/`until:`, and filters for category, folder (with
   subfolders), unsorted, tag, untagged, author, date range and content type;
   sorting by relevance, date or engagement; paging.
3. `show`, `folders`, `tags`, `accounts`, `stats` and `trends` SHALL be
   available; every command SHALL support text, Markdown (where it applies)
   and JSON output.
4. A tweet both bookmarked and liked SHALL appear once unless a category is
   chosen.
5. Bad input SHALL exit with code 2 and a message saying how to fix it.

### 3. MCP server

**User Story:** As a user, I want Claude Code / Claude Desktop to query my
saved tweets directly.

1. `twillot mcp` SHALL serve stdio MCP with read-only tools: `mirror_info`,
   `search_tweets`, `get_tweets`, `list_folders`, `list_tags`, `stats`, `trends`.
2. It SHALL pick up a refreshed mirror without restarting.
3. It SHALL offer `digest` and `organize` prompts.
4. Invalid arguments SHALL come back as tool errors, not crash the server.
