# Tech Stack & Build System

## Core Technologies

- **Language**: TypeScript (strict mode disabled, ESNext target)
- **UI Framework**: SolidJS (not React — uses `jsxImportSource: solid-js`)
- **Styling**: TailwindCSS with `tailwindcss-animate`, PostCSS, Autoprefixer
- **Component Library**: Kobalte (SolidJS headless UI, used in automation and exporter)
- **Build Tool**: Vite with `@crxjs/vite-plugin` for Chrome extension bundling
- **Package Manager**: pnpm (v8.15.4) with workspaces
- **Testing**: Vitest with `@solidjs/testing-library`, `jsdom`, `fake-indexeddb`
- **Formatter**: Prettier with `prettier-plugin-tailwindcss`

## Monorepo Structure

pnpm workspaces defined in `pnpm-workspace.yaml`:
- `packages/*` — shared packages
- `x-bookmarks` — main bookmarks extension
- `x-bookmarks-automation` — automation extension
- `exporter` — exporter extension

## Common Commands

All commands are run from within individual workspace packages (not root):

```bash
# Install dependencies (from root)
pnpm install

# Development (hot reload for extension)
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm coverage

# Format code
pnpm fmt

# Build and create zip for Chrome Web Store submission
pnpm zip
```

## Key Configuration Files

- `tsconfig.base.json` — shared TypeScript config (extended by each package)
- `vitest.workspace.json` — Vitest workspace config (covers `packages/*`)
- `.prettierrc` — Prettier config (single quotes, no semicolons, 2-space indent, trailing commas)
- Each extension has its own `vite.config.ts`, `tsconfig.json`, `tailwind.config.*`

## Code Style (from .prettierrc)

- Single quotes
- No semicolons
- 2-space indentation
- Trailing commas (all)
- LF line endings
- 80 char print width

## Chrome Extension Details

- Manifest V3 (defined programmatically in `src/manifest.ts` per extension)
- Uses `@crxjs/vite-plugin` for HMR during development
- Build output goes to `build/` directory
- Path alias: `~` maps to `./src`

## Data Layer

- IndexedDB for local bookmark storage (via custom wrapper in `packages/utils/db/`)
- Chrome Storage API for extension settings (via `@webext-core/storage`)
- No external backend — all data is stored locally in the browser
