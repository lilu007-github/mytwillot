# Implementation Plan: User Grid View

## Overview

Implement a paginated, sortable, and configurable user data grid within the Twillot Exporter options page. The grid displays synced followers/following from IndexedDB with column visibility configuration (persisted via Chrome Storage), tri-state sorting, keyword search, batch selection, and bulk actions. Built with SolidJS, TailwindCSS, and Kobalte.

## Tasks

- [x] 1. Set up grid module structure and core types
  - [x] 1.1 Create grid directory and define column types and constants
    - Create `exporter/src/options/grid/` directory
    - Create `exporter/src/options/grid/types.ts` with `ColumnDef`, `SortState`, `GridState` interfaces
    - Define `DEFAULT_COLUMNS` array and `COLUMN_PREF_KEY` constant
    - _Requirements: 1.2, 1.3_

  - [x] 1.2 Create the grid store with SolidJS createStore
    - Create `exporter/src/options/grid/gridStore.ts`
    - Define initial state: relationship='follower', page=1, pageSize=20, sort=null, selectedIds=[], columnVisibility (all true), users=[], totalCount=0, isLoading=false, error=null
    - Export store and setter functions for each state transition
    - _Requirements: 6.3, 3.6_

  - [x] 1.3 Create pure logic utility functions for grid operations
    - Create `exporter/src/options/grid/gridLogic.ts`
    - Implement `filterByRelationship(users, relationship)` — filters users by relationship field
    - Implement `filterByKeyword(users, keyword)` — case-insensitive substring match on name, screen_name, description
    - Implement `truncateKeyword(input)` — truncates to 100 chars
    - Implement `sortUsers(users, sort)` — tri-state sort with numeric, text (case-insensitive), and date comparison
    - Implement `computeTotalPages(totalCount, pageSize)` — Math.ceil division
    - Implement `navigatePage(current, total, direction)` — bounded page navigation
    - Implement `applyColumnToggle(visibility, key)` — toggle with min-one-visible guard
    - Implement `getHeaderCheckboxState(pageIds, selectedIds)` — returns 'checked' | 'unchecked' | 'indeterminate'
    - Implement `computeResetPage(stateChanged, currentPage)` — returns 1 if changed, else currentPage
    - _Requirements: 1.1, 2.2, 2.3, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.7, 4.8, 6.2, 7.1, 7.5_

- [x] 2. Implement grid data layer and column persistence
  - [x] 2.1 Create column preference persistence helpers
    - Create `exporter/src/options/grid/columnStorage.ts`
    - Implement `loadColumnPreferences()` — reads from Chrome Storage, falls back to all-visible defaults
    - Implement `saveColumnPreferences(visibility)` — writes to Chrome Storage with debounce (<1s)
    - Use `COLUMN_PREF_KEY` ('user_grid_column_visibility') as storage key
    - _Requirements: 2.4, 2.5, 2.6, 2.8_

  - [x] 2.2 Create data fetching hook that integrates with gridStore
    - Create `exporter/src/options/grid/useGridData.ts`
    - Implement a SolidJS reactive effect that calls `findUsers` from `packages/utils/db/users.ts` when relationship, keyword, or page changes
    - Apply in-memory sorting after fetch
    - Compute pagination slice from sorted results
    - Handle IndexedDB errors by setting `error` state
    - _Requirements: 1.1, 1.4, 1.5, 3.2, 3.3, 4.1, 4.2, 6.2, 7.1_

  - [x] 2.3 Write property tests for grid logic (Properties 1, 5, 6, 7, 8, 9, 13, 14, 15)
    - Create `exporter/src/options/grid/__tests__/gridLogic.property.test.ts`
    - Create `exporter/src/options/grid/__tests__/generators.ts` with fast-check arbitraries for StoredUser
    - **Property 1: Relationship filter produces only matching records**
    - **Property 5: Pagination math is correct**
    - **Property 6: Page navigation stays within valid bounds**
    - **Property 7: State changes reset pagination to page one**
    - **Property 8: Sort produces correctly ordered output**
    - **Property 9: Non-sortable columns do not change sort state**
    - **Property 13: Search results all contain keyword**
    - **Property 14: Whitespace-only search equals no search**
    - **Property 15: Keyword truncation to 100 characters**
    - **Validates: Requirements 1.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 4.1, 4.2, 4.6, 4.7, 4.8, 6.2, 6.4, 7.1, 7.2, 7.3, 7.5**

  - [x] 2.4 Write property tests for column visibility (Properties 2, 3, 4)
    - **Property 2: Column toggle changes visibility correctly**
    - **Property 3: Minimum one visible column invariant**
    - **Property 4: Column preference round-trip**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7**

  - [x] 2.5 Write unit tests for grid logic
    - Create `exporter/src/options/grid/__tests__/gridLogic.test.ts`
    - Test default column order matches spec (Req 1.2)
    - Test no DM column exists (Req 1.3)
    - Test default page size is 20 (Req 3.6)
    - Test default relationship filter is 'follower' (Req 6.3)
    - Test tri-state sort cycle: asc → desc → null (Req 4.3)
    - Test pagination hidden when totalCount = 0 (Req 3.8)
    - _Requirements: 1.2, 1.3, 3.6, 3.8, 4.3, 6.3_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement UI components — filters and search
  - [x] 4.1 Create RelationshipFilter component
    - Create `exporter/src/options/grid/RelationshipFilter.tsx`
    - Render segmented control with "Followers" and "Following" buttons
    - Highlight active filter, call onChange handler on click
    - Style with TailwindCSS
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.2 Create SearchInput component
    - Create `exporter/src/options/grid/SearchInput.tsx`
    - Render text input with placeholder
    - Apply 300ms debounce using `lodash.debounce`
    - Truncate input to 100 characters
    - Call onSearch with trimmed keyword
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [x] 4.3 Create ColumnConfig popover component
    - Create `exporter/src/options/grid/ColumnConfig.tsx`
    - Use Kobalte `Popover` primitive for dropdown
    - Render toggle switch for each column from DEFAULT_COLUMNS
    - Prevent toggling off the last visible column
    - Call onToggle handler for each change
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

- [x] 5. Implement UI components — grid table and pagination
  - [x] 5.1 Create UserGrid table component
    - Create `exporter/src/options/grid/UserGrid.tsx`
    - Render `<table>` with header row and data rows
    - Render checkbox column as first column in header and each row
    - Show/hide columns based on visibility record
    - Render sort indicators (↑/↓) on sortable column headers
    - Handle header click for sorting (no-op for non-sortable columns)
    - Handle row checkbox click for selection
    - Handle header checkbox click for select-all/deselect-all
    - Display avatar as thumbnail image, verified as badge/icon
    - Display empty state message when no users
    - Display error message when error state is set
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.8, 5.1, 5.2_

  - [x] 5.2 Create PaginationControl component
    - Create `exporter/src/options/grid/PaginationControl.tsx`
    - Display current page and total pages
    - Render previous/next buttons, disabled at boundaries
    - Render page size selector (e.g., 20, 50, 100)
    - Hide entirely when totalCount is 0
    - Call onPageChange and onPageSizeChange handlers
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 5.3 Write property tests for selection logic (Properties 10, 11, 12)
    - **Property 10: Toolbar visibility and count reflect selection state**
    - **Property 11: Header checkbox state matches selection**
    - **Property 12: Navigation and filter changes clear selection**
    - **Validates: Requirements 5.2, 5.3, 5.6, 5.7, 5.8, 6.6**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement bulk actions and toolbar
  - [x] 7.1 Create BulkActionToolbar component
    - Create `exporter/src/options/grid/BulkActionToolbar.tsx`
    - Show toolbar only when selectedCount > 0
    - Display selected count
    - Render "Move to Folder" button that triggers folder selection
    - Render "Unfollow" button that triggers confirmation dialog
    - _Requirements: 5.3, 5.6, 5.7_

  - [x] 7.2 Implement bulk unfollow action with confirmation
    - Add confirmation dialog using Kobalte `Dialog` showing user count
    - On confirm, execute unfollow API calls for selected users
    - Show success/failure notification via toast
    - Clear selection on full success; preserve failed row selections on partial failure
    - _Requirements: 5.5, 5.9, 5.10_

  - [x] 7.3 Implement Move to Folder action
    - Add folder selection UI (list of available folders)
    - On selection, update IndexedDB records for selected users
    - Show success/failure notification via toast
    - Clear selection on full success; preserve failed row selections on partial failure
    - _Requirements: 5.4, 5.9, 5.10_

  - [x] 7.4 Write property test for bulk action failure handling (Property 16)
    - **Property 16: Partial bulk action failure preserves failed selections**
    - **Validates: Requirements 5.10**

- [x] 8. Compose UserGridPage and wire routing
  - [x] 8.1 Create UserGridPage top-level component
    - Create `exporter/src/options/UserGridPage.tsx`
    - Initialize grid store on mount
    - Load column preferences from Chrome Storage on mount
    - Fetch initial user data from IndexedDB on mount
    - Compose RelationshipFilter, SearchInput, ColumnConfig, BulkActionToolbar, UserGrid, PaginationControl
    - Wire all event handlers to store actions
    - Handle state resets: clear selection on page/filter change, reset page on sort/filter/search/pageSize change
    - _Requirements: 1.1, 2.5, 2.6, 5.8, 6.4, 6.6, 7.3_

  - [x] 8.2 Add route and navigation to UserGridPage
    - Add route for UserGridPage in the options page router or entry point
    - Add navigation link/tab to access the grid view from the existing options UI
    - _Requirements: 1.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All components use SolidJS (not React), TailwindCSS for styling, and Kobalte for headless UI primitives
- The existing `findUsers` function in `packages/utils/db/users.ts` already handles relationship filtering and keyword search — the grid layer adds in-memory sorting on top
- Column preferences use Chrome Storage API via the patterns in `packages/utils/storage.ts`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "5.2"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.3"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3"] },
    { "id": 9, "tasks": ["7.4"] },
    { "id": 10, "tasks": ["8.1"] },
    { "id": 11, "tasks": ["8.2"] }
  ]
}
```
