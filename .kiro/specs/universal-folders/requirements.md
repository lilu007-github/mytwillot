# Requirements Document

## Introduction

Redesign the Folder feature to become a universal organizational concept that can independently categorize different entity types. Currently, folders are stored as a flat list of names in a single config entry (`OptionName.FOLDER`) and referenced by name on both bookmarks (tweets) and users. This change introduces entity-scoped folders so that bookmarks and users each have their own independent folder sets. The left panel is also restructured so that the Folders section appears at the bottom of the sidebar navigation.

## Glossary

- **Folder_Store**: The IndexedDB-backed persistence layer responsible for storing folder definitions, including their name, entity scope, and ordering.
- **Entity_Scope**: A discriminator indicating which entity type a folder belongs to. Valid values are `bookmark` and `user`.
- **Folder_Panel**: The collapsible section in the left sidebar that displays folders filtered by the currently active entity scope.
- **Sidebar**: The fixed left navigation panel in the x-bookmarks options page containing navigation links and the Folder_Panel.
- **Bookmark**: A synced Twitter bookmark (tweet) stored in IndexedDB.
- **User_Entity**: A synced Twitter user (follower/following) stored in IndexedDB.
- **Active_View**: The currently displayed page context (Bookmarks view or Users view) that determines which entity-scoped folders are shown.

## Requirements

### Requirement 1: Entity-Scoped Folder Storage

**User Story:** As a user, I want folders to be scoped to specific entity types, so that my bookmark folders and user folders are managed independently.

#### Acceptance Criteria

1. THE Folder_Store SHALL persist each folder with a name (1 to 50 characters), an Entity_Scope, and an integer sort order starting at 0.
2. WHEN a folder is created, THE Folder_Store SHALL associate the folder with exactly one Entity_Scope.
3. THE Folder_Store SHALL enforce unique folder names within the same Entity_Scope, while allowing identical names across different Entity_Scopes.
4. IF a folder is created with a name that already exists within the same Entity_Scope, THEN THE Folder_Store SHALL reject the operation and return an error indicating a duplicate name.
5. WHEN folders are queried, THE Folder_Store SHALL return only folders matching the requested Entity_Scope, ordered by sort order ascending.
6. THE Folder_Store SHALL migrate existing folder data from the legacy flat-list config format to the new entity-scoped format, assigning all existing folders to the `bookmark` Entity_Scope and preserving their original order as sort order values.
7. IF migration of legacy folder data fails, THEN THE Folder_Store SHALL preserve the original legacy data unchanged and report the migration error.

### Requirement 2: Folder CRUD Operations

**User Story:** As a user, I want to create, rename, reorder, and delete folders within each entity scope, so that I can organize my data flexibly.

#### Acceptance Criteria

1. WHEN a user submits a new folder name for a given Entity_Scope, THE Folder_Store SHALL trim leading and trailing whitespace from the name, then create a new folder with that trimmed name (maximum 50 characters) and append it to the end of the sort order.
2. WHEN a user deletes a folder, THE Folder_Store SHALL remove the folder definition and set the folder reference to empty on all entities assigned to that folder within the same Entity_Scope.
3. WHEN a user reorders folders via drag-and-drop, THE Folder_Store SHALL persist the new sort order for that Entity_Scope.
4. IF a user attempts to create or rename a folder with a name that is empty, whitespace-only, exceeds 50 characters, or already exists within the same Entity_Scope, THEN THE Folder_Store SHALL reject the operation, preserve the existing state, and display an error message indicating the reason for rejection.
5. WHEN a folder is deleted, THE Folder_Store SHALL not affect folders or entity assignments in other Entity_Scopes.
6. WHEN a user renames a folder within a given Entity_Scope, THE Folder_Store SHALL update the folder definition name and update the folder reference on all entities assigned to that folder within the same Entity_Scope to the new name.

### Requirement 3: Assign Entities to Folders

**User Story:** As a user, I want to move bookmarks into bookmark folders and users into user folders, so that I can categorize each entity type independently.

#### Acceptance Criteria

1. WHEN a user moves one or more bookmarks to a folder, THE Folder_Store SHALL update the folder reference on each selected bookmark to the target folder name, replacing any previously assigned folder.
2. WHEN a user moves one or more users to a folder, THE Folder_Store SHALL update the folder reference on each selected user to the target folder name, replacing any previously assigned folder.
3. THE Folder_Store SHALL allow each entity to belong to at most one folder within its Entity_Scope.
4. WHEN a user moves entities to a folder, THE Folder_Store SHALL only present folders matching the entity's Entity_Scope as valid targets.
5. IF one or more entities in a bulk move operation fail to update, THEN THE Folder_Store SHALL complete the remaining updates and report the count of succeeded and failed assignments.
6. IF the target folder does not exist in the Folder_Store at the time of assignment, THEN THE Folder_Store SHALL reject the move operation and display an error indication to the user.

### Requirement 4: Sidebar Folder Panel Placement

**User Story:** As a user, I want the Folders section to appear at the bottom of the left panel, so that navigation items are prioritized at the top.

#### Acceptance Criteria

1. THE Sidebar SHALL render navigation links (Bookmarks, Users) above the Folder_Panel.
2. THE Folder_Panel SHALL appear as the last section in the Sidebar, positioned below all navigation links.
3. THE Sidebar SHALL maintain the existing collapsible behavior for the Folder_Panel, defaulting to expanded on page load.
4. THE Folder_Panel SHALL use a sticky position at the bottom of the Sidebar so it remains visible when the navigation list scrolls.

### Requirement 5: Context-Aware Folder Display

**User Story:** As a user, I want the folder panel to show folders relevant to my current view, so that I only see bookmark folders when browsing bookmarks and user folders when browsing users.

#### Acceptance Criteria

1. WHILE the Active_View is the Bookmarks page, THE Folder_Panel SHALL display only folders with Entity_Scope `bookmark`, listed in their persisted sort order.
2. WHILE the Active_View is the Users page, THE Folder_Panel SHALL display only folders with Entity_Scope `user`, listed in their persisted sort order.
3. WHEN the user navigates between views, THE Folder_Panel SHALL update its displayed folders to match the new Active_View's Entity_Scope.
4. WHILE the Active_View is a page with an associated Entity_Scope, THE Folder_Panel SHALL display an "Unsorted" entry showing the count of entities in that Entity_Scope that have no folder assigned.
5. WHILE the Active_View is a page with no associated Entity_Scope (e.g., Lists, Discover), THE Folder_Panel SHALL be hidden.
6. WHILE no folders exist for the current Active_View's Entity_Scope, THE Folder_Panel SHALL display only the "Unsorted" entry and no folder list.

### Requirement 6: Folder Filtering

**User Story:** As a user, I want to click a folder in the panel to filter the main content area by that folder, so that I can quickly find categorized items.

#### Acceptance Criteria

1. WHEN a user clicks a folder in the Folder_Panel, THE Active_View SHALL filter its displayed entities to show only those assigned to the selected folder.
2. WHEN a user clicks "Unsorted" in the Folder_Panel, THE Active_View SHALL filter its displayed entities to show only those with no folder assigned.
3. WHEN a folder filter is active, THE Folder_Panel SHALL apply a distinct background color to the selected folder entry.
4. WHEN the user clicks the currently active folder again, THE Active_View SHALL clear the folder filter and display all entities.
5. WHEN the user navigates to a different view, THE Active_View SHALL clear any previously active folder filter.
6. WHEN a folder filter is active, THE Pagination_Control SHALL reset to page one.

### Requirement 7: Migration of Existing Data

**User Story:** As an existing user, I want my current folders and assignments to be preserved after the upgrade, so that I do not lose my organizational work.

#### Acceptance Criteria

1. WHEN the extension upgrades to the new folder system, THE Folder_Store SHALL migrate all existing folder names from the legacy config (OptionName.FOLDER string array in the settings object store) to entity-scoped folder records, creating one record per folder name with Entity_Scope `bookmark`.
2. WHEN the migration completes, THE Folder_Store SHALL preserve all existing bookmark-to-folder assignments by retaining the `folder` field value on each post record without modification.
3. WHEN the migration completes, THE Folder_Store SHALL create a corresponding folder record with Entity_Scope `user` for each distinct non-empty `folder` value found across user records in the users object store.
4. IF the migration encounters an error during any record write, THEN THE Folder_Store SHALL log the error to the console, abort the IndexedDB transaction so that existing data remains unmodified, and leave the database at the prior version.
5. THE Folder_Store SHALL execute the migration exactly once, triggered by the IndexedDB version increment in the `onupgradeneeded` event, so that subsequent opens at the same version skip migration.
6. WHEN the migration reads the legacy OptionName.FOLDER config, IF the config value is empty, null, or contains zero folder names, THEN THE Folder_Store SHALL complete the migration successfully without creating any folder records.
