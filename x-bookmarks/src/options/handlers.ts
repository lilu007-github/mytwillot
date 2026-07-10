/**
 * Barrel for the options-page handlers, split by responsibility:
 * - query.ts          — read-side list querying, pagination, navigation
 * - sync-bookmarks.ts — bookmark sync engine, reconciliation, threads, delete
 * - ai-actions.ts     — AI auto-organize and summarize batch runs
 *
 * Import from here (or from the specific module) — both work; this barrel
 * exists so existing call sites don't churn.
 */
export * from './query'
export * from './sync-bookmarks'
export * from './ai-actions'
