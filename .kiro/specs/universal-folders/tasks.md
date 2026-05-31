# Implementation Plan: Universal Folders

## Overview

This plan implements entity-scoped folders for the x-bookmarks extension. The work progresses from shared types and data layer (packages/utils), through migration logic, to the SolidJS store rewrite and UI components. Each step builds incrementally so there is no orphaned code.

## Tasks

- [x] 1. Define types and data layer interfaces
  - [x] 1.1 Create folder types and error classes
    - Create `packages/utils/types/folder.ts` with `EntityScope` type, `Folder` interface, and typed error classes (`DuplicateFolderError`, `InvalidFolderNameError`, `FolderNotFoundError`)
    - Export from `packages/utils/types/index.ts`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Implement folder validation utility
    - Create `packages/utils/db/folder-validation.ts` with `validateFolderName(name: string, scope: EntityScope, existingNames: string[]): string | Error` that trims whitespace, checks length 1–50, and checks uniqueness within scope
    - _Requirements: 2.1, 2.4_

  - [x] 1.3 Implement IndexedDB folder CRUD module
    - Create `packages/utils/db/folders.ts` with functions: `getFolderId`, `createFolder`, `renameFolder`, `deleteFolder`, `reorderFolders`, `getFoldersByScope`, `folderExists`
    - Use the existing `openDb` pattern from `packages/utils/db/index.ts`
    - `createFolder` trims name, validates, assigns next sort_order, writes to `folders` store
    - `renameFolder` validates new name, updates folder record, updates all entity records in the same scope
    - `deleteFolder` removes folder record, clears folder field on all entities in the same scope
    - `reorderFolders` accepts ordered name array, updates sort_order for each folder in the scope
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 2.6_

- [x] 2. Database schema upgrade and migration
  - [x] 2.1 Bump DB version and create folders object store
    - In `packages/utils/db/index.ts`, increment `DB_VERSION` from 21 to 22
    - In `upgradeDb`, create `folders` object store with keyPath `id`, indexes on `owner_id`, `scope`, `sort_order`, and compound index `[owner_id, scope]`
    - Add `folder` index to `users` store if not already present
    - _Requirements: 1.1, 1.6_

  - [x] 2.2 Implement legacy folder migration logic
    - In the `upgradeDb` function (or a dedicated `migrateToV22` helper), read `OptionName.FOLDER` config from `settings` store for the current user
    - For each folder name in the legacy array, create a `Folder` record with `scope: 'bookmark'` and `sort_order` equal to array index
    - Scan `users` store for distinct non-empty `folder` values, create `Folder` records with `scope: 'user'`
    - Handle empty/null legacy config gracefully (no records created)
    - On failure, let the transaction abort to preserve data at version 21
    - _Requirements: 1.6, 1.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 2.3 Write property tests for migration (Properties 4, 16, 17)
    - **Property 4: Migration maps legacy folders to bookmark scope**
    - **Property 16: Migration preserves post folder fields**
    - **Property 17: Migration creates user-scoped folders from user records**
    - Use `fake-indexeddb` and `fast-check` to generate arbitrary legacy folder arrays and user records
    - **Validates: Requirements 1.6, 7.1, 7.2, 7.3**

- [x] 3. Checkpoint - Ensure data layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Folder CRUD property tests
  - [ ]* 4.1 Write property test for folder structural integrity
    - **Property 1: Folder structural integrity**
    - Generate arbitrary valid folder names (1–50 chars, non-whitespace-only) and scopes, create folder, read back, assert fields match
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 4.2 Write property test for uniqueness within scope
    - **Property 2: Uniqueness within scope**
    - Generate folder name and both scopes, assert duplicate in same scope rejected, same name in other scope succeeds
    - **Validates: Requirements 1.3, 1.4**

  - [ ]* 4.3 Write property test for scope-filtered query correctness
    - **Property 3: Scope-filtered query correctness**
    - Generate folders across both scopes, query each scope, assert only matching scope returned in sort_order
    - **Validates: Requirements 1.5**

  - [ ]* 4.4 Write property test for whitespace trimming
    - **Property 5: Whitespace trimming on create**
    - Generate strings with leading/trailing whitespace, assert stored name is trimmed and sort_order is appended
    - **Validates: Requirements 2.1**

  - [ ]* 4.5 Write property test for delete cascade
    - **Property 6: Delete cascade clears entity references**
    - Create folder, assign entities, delete folder, assert folder gone and entity folder fields cleared
    - **Validates: Requirements 2.2**

  - [ ]* 4.6 Write property test for reorder permutation
    - **Property 7: Reorder persists permutation**
    - Generate permutation of folder names, call reorder, assert sort_order matches new positions
    - **Validates: Requirements 2.3**

  - [ ]* 4.7 Write property test for invalid name rejection
    - **Property 8: Invalid names are rejected**
    - Generate empty, whitespace-only, >50 char, and duplicate names, assert rejection and state unchanged
    - **Validates: Requirements 2.4**

  - [ ]* 4.8 Write property test for delete isolation across scopes
    - **Property 9: Delete isolation across scopes**
    - Delete folder in one scope, assert other scope's folders and entity assignments unchanged
    - **Validates: Requirements 2.5**

  - [ ]* 4.9 Write property test for rename cascade
    - **Property 10: Rename cascade updates entity references**
    - Rename folder with assigned entities, assert folder record and all entity folder fields updated
    - **Validates: Requirements 2.6**

  - [ ]* 4.10 Write property test for entity assignment
    - **Property 11: Entity assignment replaces previous folder**
    - Move entities to target folder, assert folder field equals target regardless of previous value
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 4.11 Write property test for non-existent folder rejection
    - **Property 12: Non-existent folder assignment rejected**
    - Attempt move to non-existent folder name, assert rejection and no entity modifications
    - **Validates: Requirements 3.6**

- [x] 5. Rewrite the SolidJS folder store
  - [x] 5.1 Rewrite `x-bookmarks/src/stores/folders.ts`
    - Replace the existing store with a new implementation backed by the `folders` object store
    - Expose reactive state: `folders: Folder[]`, `activeScope: EntityScope`, `activeFolder: string | null`
    - Implement `initFolders(scope: EntityScope)` that loads folders from IndexedDB filtered by scope
    - Implement `createFolder(name: string)`, `renameFolder(oldName, newName)`, `deleteFolder(name)`, `reorderFolders(orderedNames)` — all scoped to `activeScope`
    - Implement `moveEntitiesToFolder(entityIds: string[], folderName: string)` that validates folder exists, updates entity records, handles partial failures
    - Implement `setActiveScope(scope: EntityScope)` triggered by route changes
    - Implement `setActiveFolder(name: string | null)` for filter selection
    - Surface errors via a reactive `error` signal for UI consumption
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 5.2 Write property test for unsorted count correctness
    - **Property 14: Unsorted count correctness**
    - Generate entities with various folder assignments, assert unsorted count equals entities with empty/null folder
    - **Validates: Requirements 5.4**

- [x] 6. Checkpoint - Ensure store and data layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement FolderPanel UI component
  - [x] 7.1 Create `x-bookmarks/src/components/FolderPanel.tsx`
    - Replace `AsideFolder.tsx` with a new `FolderPanel` component
    - Subscribe to the folder store's `folders` and `activeFolder` signals
    - Render "Unsorted" entry with count of unassigned entities for the active scope
    - Render folder list in sort_order with name and count
    - Highlight active folder with distinct background color (TailwindCSS class)
    - Implement click-to-filter: clicking a folder sets `activeFolder`, clicking again clears it
    - Implement inline folder creation form (text input + submit)
    - Implement inline rename (double-click folder name to edit)
    - Implement delete button (with confirmation)
    - Implement drag-and-drop reorder using HTML5 drag events (same pattern as existing `AsideFolder.tsx`)
    - Display error toasts from the store's error signal
    - _Requirements: 4.3, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2, 6.3, 6.4_

  - [x] 7.2 Modify `x-bookmarks/src/options/Layout.tsx` for new sidebar structure
    - Move the Folder Panel to the bottom of the sidebar, below all navigation links (Bookmarks, Users)
    - Add sticky positioning to the Folder Panel section so it remains visible when nav scrolls
    - Determine active scope from current route (`/` → `bookmark`, `/users` → `user`)
    - Pass scope to `FolderPanel` and call `setActiveScope` on route change
    - Hide `FolderPanel` on pages with no entity scope (e.g., `/lists`, `/discover`)
    - Remove the old `AsideFolder` import and usage
    - Clear active folder filter on navigation between views
    - _Requirements: 4.1, 4.2, 4.4, 5.1, 5.2, 5.3, 5.5, 6.5_

  - [x] 7.3 Update `x-bookmarks/src/options/grid/MoveToFolderDialog.tsx`
    - Filter the folder list by the current entity scope (use folder store's `activeScope`)
    - Validate target folder exists before executing move
    - Handle partial bulk move failures with success/failure count toast
    - _Requirements: 3.4, 3.5, 3.6_

  - [ ]* 7.4 Write property test for context-aware folder display
    - **Property 13: Context-aware folder display**
    - Use `@solidjs/testing-library` + `fake-indexeddb` to render FolderPanel with different scopes, assert only matching folders shown in sort order
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 7.5 Write property test for folder filter correctness
    - **Property 15: Folder filter correctness**
    - Generate entities with various folder assignments, select a folder filter, assert displayed entities match selection
    - **Validates: Requirements 6.1, 6.2**

- [x] 8. Wire filtering into entity grid views
  - [x] 8.1 Connect folder filter to bookmark grid query
    - In the bookmarks grid view, read `activeFolder` from the folder store
    - When `activeFolder` is set, pass it to the existing `findRecords` query (filter by `folder` index)
    - When `activeFolder` is `'Unsorted'`, filter for records where `folder` is empty/null
    - When `activeFolder` is `null`, show all records (no folder filter)
    - Reset pagination to page 1 when folder filter changes
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6_

  - [x] 8.2 Connect folder filter to users grid query
    - In the users grid view, read `activeFolder` from the folder store
    - Apply the same filtering logic as bookmarks but against the `users` store
    - Reset pagination to page 1 when folder filter changes
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `AsideFolder.tsx` is replaced by `FolderPanel.tsx` — remove the old file after wiring is complete
- The `x-bookmarks/src/stores/folders.ts` rewrite preserves the X folder sync functionality (`syncXFolders`) but adapts it to use the new data layer

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2"] },
    { "id": 3, "tasks": ["2.3", "4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "7.1", "7.3"] },
    { "id": 7, "tasks": ["7.2", "7.4", "7.5"] },
    { "id": 8, "tasks": ["8.1", "8.2"] }
  ]
}
```
