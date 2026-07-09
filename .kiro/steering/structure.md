# Project Structure

## Root Layout

```
mytwillot-1/
├── packages/          # Shared packages (workspace)
│   └── utils/         # Shared utilities used by all extensions
├── x-bookmarks/       # Main bookmarks Chrome extension
├── x-bookmarks-automation/  # Automation Chrome extension
├── exporter/          # Data exporter Chrome extension
├── docs/              # Project documentation and API req/res samples
├── scripts/           # Build/utility scripts
├── multi-publish/     # Multi-store publishing tooling
├── submit/            # Chrome Web Store submission assets
└── .kiro/             # Kiro configuration and steering
```

## Shared Package: `packages/utils/`

Shared code consumed by all three extensions via `"utils": "workspace:*"`.

```
packages/utils/
├── api/               # Twitter API client and response parsing
│   ├── twitter-base.ts
│   ├── twitter-features.ts
│   ├── twitter-media.ts
│   ├── twitter-res-utils.ts
│   ├── twitter-user.ts
│   └── twitter.ts
├── db/                # IndexedDB data access layer
│   ├── index.ts       # DB initialization
│   ├── tweets.ts      # Tweet/bookmark CRUD
│   ├── users.ts       # User data
│   └── configs.ts     # Extension config storage
├── hooks/             # Shared SolidJS hooks
├── types/             # Shared TypeScript type definitions
│   ├── tweet.ts
│   ├── user.ts
│   ├── configs.ts
│   ├── list.ts
│   └── product.ts
├── browser.ts         # Browser/extension API helpers
├── storage.ts         # Chrome storage utilities
├── xfetch.ts          # Fetch wrapper for Twitter API
├── query-parser.ts    # Search query parsing
├── date.ts            # Date utilities
├── text.ts            # Text processing
├── dom.ts             # DOM utilities
├── exporter.ts        # Export format helpers
└── color.ts           # Color utilities
```

## Extension Structure (shared pattern)

Each extension follows the same directory layout:

```
<extension>/
├── src/
│   ├── manifest.ts        # Chrome extension manifest (MV3)
│   ├── background/        # Service worker (background script)
│   ├── contentScript/     # Content scripts injected into X/Twitter
│   ├── components/        # SolidJS UI components
│   ├── options/           # Extension options page
│   ├── popup/             # Browser action popup (x-bookmarks)
│   ├── sidepanel/         # Side panel UI (x-bookmarks)
│   ├── newtab/            # New tab page (x-bookmarks)
│   ├── devtools/          # DevTools panel
│   ├── hooks/             # Extension-specific SolidJS hooks
│   ├── stores/            # SolidJS stores/state management
│   ├── libs/              # Extension-specific utilities
│   ├── assets/            # CSS and static assets
│   ├── rules.json         # Declarative net request rules
│   └── zip.js             # Build zip script for store submission
├── pages/                 # HTML entry points
├── public/                # Static assets (icons, images)
├── build/                 # Build output (gitignored)
├── __mocks__/             # Test mocks
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── tailwind.config.*
└── package.json
```

## Documentation: `docs/`

```
docs/
├── project-prompt.md      # Product copy and marketing prompts
├── flow.md                # User flow documentation
├── errors.md              # Error handling documentation
└── req-res/               # Twitter API request/response samples
    ├── bookmark-create.md
    ├── followers.md
    ├── posts.md
    └── ...
```
