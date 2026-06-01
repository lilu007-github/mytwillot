# Implementation Plan: Multi-Account Support

## Overview

This plan implements multi-account support for the Twillot Chrome extension suite. The implementation builds on the existing `owner_id` partitioning in IndexedDB and the `user:{user_id}:` namespacing in Chrome Storage. New modules include an Account Manager, a Data Context Guard, Sync Engine extensions, an Account Indicator UI component, and an Account Cleanup Service.

## Tasks

- [x] 1. Create Account Manager module and core interfaces
  - [x] 1.1 Create `packages/utils/account-manager.ts` with `AccountEntry` interface and Account Registry CRUD
    - Define `AccountEntry` interface (`user_id`, `screen_name`, `profile_image_url`, `first_seen_at`, `last_active_at`)
    - Implement `getAccountRegistry()` — reads `account_registry` from Chrome Storage, returns entries sorted by `last_active_at` desc
    - Implement `upsertAccountEntry()` — adds new entry or updates existing (preserves `first_seen_at`), enforces 20-entry cap by evicting oldest
    - Implement `removeAccount()` — removes entry from registry (rejects if active account)
    - Implement `getActiveAccountId()` — reads `current_user_id` from Chrome Storage
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

  - [ ]* 1.2 Write property test for registry upsert correctness
    - **Property 3: Registry Upsert Correctness**
    - **Validates: Requirements 2.1, 2.5**

  - [ ]* 1.3 Write property test for registry invariants (sorted and bounded)
    - **Property 4: Registry Invariants (Sorted and Bounded)**
    - **Validates: Requirements 2.3, 2.4**

- [x] 2. Implement account detection and cookie parsing
  - [x] 2.1 Create `packages/utils/cookie-parser.ts` with `parseTwidCookie()` function
    - Extract numeric user ID from `twid` cookie value (format `u%3D{user_id}`)
    - Return empty string for absent, malformed, or non-numeric values
    - _Requirements: 1.1, 1.3_

  - [ ]* 2.2 Write property test for cookie parsing round-trip
    - **Property 1: Cookie Parsing Round-Trip**
    - **Validates: Requirements 1.1, 1.3**

  - [x] 2.3 Refactor `x-bookmarks/src/contentScript/index.ts` to use `parseTwidCookie()` and trigger account switch detection
    - Replace inline cookie parsing with `parseTwidCookie()`
    - Call `detectAndSetActiveAccount()` which compares parsed ID with stored `current_user_id`
    - If different, update `current_user_id` in Chrome Storage and call `upsertAccountEntry()`
    - If cookie absent/invalid, set `current_user_id` to empty string
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.5, 2.6_

  - [ ]* 2.4 Write property test for storage key namespacing
    - **Property 2: Storage Key Namespacing**
    - **Validates: Requirements 1.5, 3.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Data Context Guard
  - [x] 4.1 Create `packages/utils/db/context-guard.ts` with ownership validation
    - Implement `requireActiveAccount()` — throws `NoActiveAccountError` if `current_user_id` is empty/null/undefined
    - Implement `validateOwnership(recordOwnerId)` — throws `OwnershipMismatchError` if record's owner doesn't match active account
    - Implement `withOwnershipCheck()` — wraps a DB operation with both checks
    - _Requirements: 3.4, 3.5_

  - [ ]* 4.2 Write property test for empty owner rejects operations
    - **Property 6: Empty Owner Rejects Operations**
    - **Validates: Requirements 3.4**

  - [ ]* 4.3 Write property test for ownership mismatch rejects writes
    - **Property 7: Ownership Mismatch Rejects Writes**
    - **Validates: Requirements 3.5**

  - [x] 4.4 Integrate context guard into existing DB operations in `packages/utils/db/tweets.ts` and `packages/utils/db/configs.ts`
    - Add `requireActiveAccount()` call at the start of `upsertRecords()`, `findRecords()`, `getRecord()`, `deleteRecord()`
    - Add `requireActiveAccount()` call at the start of `upsertConfig()`, `readConfig()`, `deleteConfig()`
    - Ensure all write operations validate ownership before persisting
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [ ]* 4.5 Write property test for data isolation on query
    - **Property 5: Data Isolation on Query**
    - **Validates: Requirements 3.1**

- [x] 5. Implement Sync Engine extensions for account switch
  - [x] 5.1 Create `packages/utils/sync-engine.ts` with `SyncState` interface and sync coordination
    - Define `SyncState` interface (`status`, `progress`, `total`, `owner_id`, `error_message`)
    - Implement `startFullSync(userId)` — resets `bookmark_cursor` for the user, sets sync state to `syncing`, begins fetching
    - Implement `cancelCurrentSync()` — persists current cursor position, sets sync state to `idle`
    - Implement `resumeSync(userId)` — reads persisted cursor and continues from that position
    - Implement `getSyncState()` — reads per-account sync state from Chrome Storage key `user:{uid}:sync_state`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_

  - [ ]* 5.2 Write property test for sync resume from last cursor
    - **Property 8: Sync Resume from Last Cursor**
    - **Validates: Requirements 4.4**

  - [x] 5.3 Wire account switch handling in `x-bookmarks/src/background/index.ts`
    - Listen for `chrome.storage.onChanged` on `current_user_id` key
    - On change: cancel current sync if active, update registry `last_active_at`, reset cursor, start full sync for new account
    - Ensure previous account's data is not modified during switch
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7, 5.1, 5.2_

  - [ ]* 5.4 Write property test for account switch preserves previous data
    - **Property 9: Account Switch Preserves Previous Data**
    - **Validates: Requirements 5.1, 5.2**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Account-Aware UI
  - [x] 7.1 Create `x-bookmarks/src/components/AccountIndicator.tsx` SolidJS component
    - Display active account's profile image (32×32px) and screen name (truncated at 20 chars with ellipsis)
    - Show sync status badge when `syncStatus === 'syncing'` with progress count
    - Show fallback placeholder icon when profile image fails to load
    - Hide indicator and show login prompt when active account is empty
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.2 Integrate `AccountIndicator` into `x-bookmarks/src/options/Layout.tsx` sidebar
    - Position at the top of the sidebar `<aside>` element, above the navigation links
    - Wire reactive signals from Chrome Storage (`current_user_id`, account registry, sync state)
    - Update indicator within 2 seconds of account change
    - _Requirements: 6.1, 6.2_

  - [ ]* 7.3 Write unit tests for AccountIndicator component rendering states
    - Test rendering with valid account data
    - Test sync badge visibility during sync
    - Test fallback placeholder on image error
    - Test hidden state when no account detected
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_

- [x] 8. Implement Account Cleanup Service
  - [x] 8.1 Create `packages/utils/account-cleanup.ts` with deletion logic
    - Implement `canDelete(userId)` — returns false if userId matches `current_user_id`
    - Implement `deleteAccountData(userId)` — deletes all IndexedDB records where `owner_id === userId`, removes all Chrome Storage keys matching `user:{userId}:*`, removes from registry
    - Handle partial failures: if one store fails, report partial failure and keep registry entry
    - Return `AccountCleanupResult` with status of each deletion step
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 8.2 Write property test for account deletion completeness
    - **Property 10: Account Deletion Completeness**
    - **Validates: Requirements 7.2, 7.3, 7.4**

  - [ ]* 8.3 Write property test for active account cannot be deleted
    - **Property 11: Active Account Cannot Be Deleted**
    - **Validates: Requirements 7.5**

  - [x] 8.4 Add account deletion confirmation UI in the options page
    - Add account management section showing registered accounts from the registry
    - Show confirmation dialog before deletion (requirement 7.1)
    - Display error message if attempting to delete active account
    - Show success/partial-failure notification after deletion
    - _Requirements: 7.1, 7.5, 7.6, 7.7_

- [x] 9. Integration wiring and data preservation on switch-back
  - [x] 9.1 Ensure switch-back makes existing data immediately queryable
    - When switching back to a previously used account, existing IndexedDB records and Chrome Storage entries are available for UI display within 1 second
    - Background sync starts for new data without blocking UI
    - Handle server-side bookmark deletions during sync (remove local records that no longer exist on server)
    - _Requirements: 5.3, 5.4_

  - [x] 9.2 Wire content script account detection across all extensions
    - Update `exporter/src/contentScript/index.ts` to use the shared `parseTwidCookie()` and `detectAndSetActiveAccount()`
    - Update `x-bookmarks-automation/src/contentScript/index.ts` similarly
    - Ensure all extensions share the same account detection logic from `packages/utils`
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 9.3 Write integration tests for full account switch flow
    - Test: detect new account → update storage → cancel old sync → start new sync
    - Test: switch back to previous account → data immediately available
    - Test: background script reacts to `chrome.storage.onChanged` events correctly
    - _Requirements: 4.1, 4.2, 4.5, 4.7, 5.1, 5.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `owner_id` partitioning in IndexedDB and `user:{user_id}:` namespacing in Chrome Storage are already in place — this implementation formalizes and guards those patterns
- All new modules go in `packages/utils/` for cross-extension sharing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["4.5", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 9, "tasks": ["9.1", "9.2"] },
    { "id": 10, "tasks": ["9.3"] }
  ]
}
```
