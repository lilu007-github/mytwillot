# Product Overview

Twillot is a suite of Chrome extensions for X/Twitter power users. The core value proposition is syncing, searching, organizing, and exporting Twitter bookmarks — overcoming Twitter's native limitations (1000 bookmark cap, no keyword search, no backup, no timeline).

## Extensions

- **x-bookmarks** (main): Search, organize, and export Twitter bookmarks. Includes AI-powered smart categorization/tagging, folder management, keyword search, multi-format export, Obsidian integration, and media download.
- **x-bookmarks-automation**: On bookmark, auto like / repost / reply, and optionally POST the tweet to the user's own webhook.
- **exporter**: One-click data export tool for X/Twitter (followers, bookmarks, etc.).

## Key Capabilities

- Sync Twitter bookmarks to local IndexedDB storage
- Full-text keyword search across bookmarks
- AI-powered automatic tagging/categorization
- Export to CSV, Excel (.xlsx), JSON, Markdown, PDF, and Obsidian (vault zip, direct vault write, Local REST API push)
- Media file downloads from bookmarks
- Folder management without Twitter Premium
- Omnibox quick search (prefix: `tt`)

## Pricing

Everything is free and unlimited. There is no license server, membership tier, or Twillot backend — all data stays in the browser, and the only outbound calls are to X, the user's own LLM provider, the user's Obsidian, and the user's own webhook.

## License

MPL-2.0
