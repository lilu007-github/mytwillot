# twillot CLI / MCP server

Query your X bookmarks, likes and posts from the terminal or from any MCP
client (Claude Code, Claude Desktop, …) — for research, summaries, organizing
and spotting trends in what you read.

The browser extension keeps your data in IndexedDB, which nothing outside the
browser can read. So the extension **mirrors** it as plain files into a folder
you choose, and this CLI reads that folder. Read-only; nothing leaves your
machine.

中文使用指南：[docs/agent-access.md](../../docs/agent-access.md)

## Setup

1. In the extension: **Export → Agent access (CLI / MCP) → Choose mirror
   folder**. The mirror refreshes whenever the options page opens and every
   15 minutes while it stays open; "Mirror now" forces it.
2. Build the CLI and point it at that folder:

   ```bash
   pnpm install
   pnpm --filter twillot-cli build
   node packages/cli/dist/twillot.mjs init ~/twillot-mirror
   ```

   Optional: `cd packages/cli && pnpm link --global` to get a `twillot`
   command. The folder can also come from `--data <dir>` or `$TWILLOT_DATA`.

3. Hook it into an agent:

   ```bash
   # Claude Code
   claude mcp add twillot -- node /abs/path/packages/cli/dist/twillot.mjs mcp
   ```

   Claude Desktop (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "twillot": {
         "command": "node",
         "args": ["/abs/path/packages/cli/dist/twillot.mjs", "mcp"]
       }
     }
   }
   ```

## Commands

```bash
twillot search "claude agents" --since 30d         # all terms must match
twillot search '"vector database" -pinecone from:simonw'
twillot search --folder AI --sort engagement --limit 50
twillot search --unsorted --category bookmarks -f md   # Markdown, full text
twillot show 1811044379643293932 https://x.com/a/status/123
twillot folders | twillot tags | twillot accounts
twillot stats --since 1y
twillot trends --period month --since 6m           # topics + rising terms
twillot sql "select author, count(*) n from tweets group by 1 order by 2 desc limit 10"
twillot sql --schema                               # tables and columns
twillot index --rebuild                            # force-rebuild the SQLite index
```

Search uses a SQLite FTS5 index built from the mirror on first use and
rebuilt when the mirror changes (`~/.cache/twillot`, or `$TWILLOT_CACHE_DIR`).
Chinese is word-segmented before indexing; hits rank by bm25, and
substring-only matches still appear after them. `twillot sql` runs read-only
SQL over the same index; wrap search words in `fts_query()` to use full-text
search from SQL. Needs Node 22.13+ (built-in `node:sqlite`); older Node falls
back to scanning.

Filters (search / stats / trends): `--category`, `--folder` (includes
subfolders), `--unsorted`, `--tag`, `--untagged`, `--author`, `--since`,
`--until` (`7d`, `2w`, `3m`, `1y`, `2026-01-01`, `2026-01`), `--has
media|link|thread|quote`. Output: `--format text|md|json` or `--json`. Several
accounts mirrored? Pick one with `--account <screen_name>`; default is the most
recently mirrored.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `mirror_info` | Accounts, last mirror time, counts — data freshness |
| `search_tweets` | Same query language and filters as `twillot search` |
| `get_tweets` | Full records (thread, quoted tweet, media, metrics) by id/URL |
| `list_folders`, `list_tags` | Organization with counts |
| `stats` | Totals by category/month, top authors/folders/tags |
| `trends` | Per-period top terms (Chinese + English), hashtags, authors; rising terms |
| `query_sql` | Read-only SQL over the index (schema in the tool description) |

Prompts: `digest` (themed summary of a period) and `organize` (propose folders
and tags for unsorted bookmarks; apply them in the extension).

## Data format

See the `README.md` the extension writes into the mirror folder, or
`packages/utils/agent-mirror.ts` (`AGENT_MIRROR_SCHEMA`). One JSON object per
line in `accounts/<owner_id>/tweets.jsonl`, so `jq`, DuckDB or a script can
read it too:

```bash
jq -r 'select(.folder=="AI") | .url' accounts/*/tweets.jsonl
duckdb -c "select author.screen_name, count(*) from 'accounts/*/tweets.jsonl' group by 1 order by 2 desc limit 10"
```
