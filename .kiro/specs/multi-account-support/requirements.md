# Requirements Document

## Introduction

Add multi-account support to the Twillot Chrome extension suite. Currently, all extensions share a single data context — when a user switches X/Twitter accounts in the browser, the extension data (bookmarks, folders, users, settings) from the previous account bleeds into the new account's view. This feature introduces per-account data isolation so that each X/Twitter account has its own independent dataset, and switching to an account triggers a full data sync from scratch for that account.

## Glossary

- **Account_Manager**: The module responsible for detecting the active X/Twitter account, maintaining a registry of known accounts, and coordinating account switch events.
- **Active_Account**: The X/Twitter account currently logged in within the browser, identified by its numeric user ID extracted from the `twid` cookie.
- **Account_Registry**: A persistent list of all X/Twitter accounts that have been used with the extension, stored in Chrome Storage.
- **Data_Context**: The complete set of IndexedDB records (bookmarks, users, folders, configs) and Chrome Storage entries belonging to a single account.
- **Sync_Engine**: The component that fetches bookmarks and related data from the X/Twitter API and persists them into the local Data_Context.
- **Account_Switch_Event**: The event raised when the Account_Manager detects that the Active_Account has changed from one user ID to another.
- **Owner_ID**: The numeric X/Twitter user ID used as a partition key to scope IndexedDB records to a specific account.

## Requirements

### Requirement 1: Account Detection

**User Story:** As a user, I want the extension to automatically detect which X/Twitter account I am logged into, so that it can load the correct data without manual intervention.

#### Acceptance Criteria

1. WHEN the content script loads on an X/Twitter page, THE Account_Manager SHALL extract the Active_Account user ID by parsing the numeric value from the browser `twid` cookie (encoded as `u%3D{user_id}`).
2. WHEN the content script loads and detects a `twid` cookie value different from the currently stored Active_Account user ID, THE Account_Manager SHALL update the Active_Account to the new user ID within 5 seconds of page load.
3. IF the `twid` cookie is absent or its value does not contain a numeric user ID after removing the `u%3D` prefix, THEN THE Account_Manager SHALL set the Active_Account to an empty string in Chrome Storage and THE extension SHALL not initiate bookmark sync, API requests, or data export operations until a valid numeric user ID is detected.
4. THE Account_Manager SHALL store the detected Active_Account user ID in Chrome Storage under the key `current_user_id`, accessible to all extension components (background script, options page, popup, side panel).
5. WHEN the Active_Account user ID changes in Chrome Storage, THE Account_Manager SHALL namespace all subsequent per-user storage operations under the prefix `user:{user_id}:` to isolate data between accounts.

### Requirement 2: Account Registry

**User Story:** As a user, I want the extension to remember all accounts I have used, so that I can see my account history and manage stored data.

#### Acceptance Criteria

1. WHEN a new Active_Account is detected that does not exist in the Account_Registry, THE Account_Manager SHALL add an entry containing the user ID, screen name, profile image URL, the timestamp of first detection, and a last-active timestamp initialized to the current time.
2. THE Account_Registry SHALL persist across browser restarts using Chrome Storage local area.
3. WHEN the Account_Registry is queried, THE Account_Manager SHALL return all registered accounts sorted by last-active timestamp in descending order (most recent first).
4. WHEN a new account would cause the Account_Registry to exceed 20 entries, THE Account_Manager SHALL remove the entry with the oldest last-active timestamp before adding the new entry.
5. WHEN an Active_Account is detected that already exists in the Account_Registry, THE Account_Manager SHALL update the entry's screen name, profile image URL, and last-active timestamp to reflect the current values.
6. IF the Account_Manager cannot retrieve the screen name or profile image URL at the time of account detection, THEN THE Account_Manager SHALL store the entry with the user ID and timestamps only, and populate the screen name and profile image URL when they become available from a subsequent API response or page context.
7. WHEN an account entry is evicted from the Account_Registry due to the 20-account limit, THE Account_Manager SHALL remove only the registry entry and SHALL NOT delete the evicted account's Data_Context.

### Requirement 3: Data Isolation

**User Story:** As a user, I want each account's bookmarks, folders, users, and settings to be completely separate, so that switching accounts does not mix data.

#### Acceptance Criteria

1. THE Data_Context SHALL partition all IndexedDB records (bookmarks, users, folders, configs) by Owner_ID so that queries for one account never return records belonging to another account.
2. THE Data_Context SHALL partition Chrome Storage entries (auth tokens, sync cursors, task state) by Owner_ID using a namespaced key format `user:{owner_id}:{key}`.
3. WHEN the Active_Account changes, THE Data_Context SHALL immediately re-scope all subsequent read and write operations to the newly active Owner_ID without requiring a page reload.
4. IF the Active_Account Owner_ID is null, undefined, or an empty string, THEN THE Data_Context SHALL reject all read and write operations and return an error indicating no active account.
5. IF a write operation targets a record whose Owner_ID does not match the current Active_Account Owner_ID, THEN THE Data_Context SHALL reject the operation and return an error indicating an ownership mismatch.

### Requirement 4: Account Switch and Full Sync

**User Story:** As a user, I want the extension to sync all data from scratch when I switch to a different account, so that I always have complete and up-to-date data for the active account.

#### Acceptance Criteria

1. WHEN an Account_Switch_Event occurs, THE Sync_Engine SHALL reset the bookmark sync cursor for the new Active_Account to empty, causing the next sync to fetch all bookmarks from the beginning.
2. WHEN an Account_Switch_Event occurs, THE Sync_Engine SHALL begin syncing bookmarks for the new Active_Account within 5 seconds without requiring user intervention.
3. WHILE a full sync is in progress, THE Sync_Engine SHALL display a progress indicator showing the number of bookmarks synced so far, updated after each fetched page of results is persisted.
4. IF a full sync is interrupted (browser closed, network error), THEN THE Sync_Engine SHALL resume from the last successfully saved cursor position when the content script next loads on an X/Twitter page for the same Active_Account.
5. WHEN an Account_Switch_Event occurs, THE Account_Manager SHALL update the Active_Account in Chrome Storage before the Sync_Engine begins its work.
6. WHEN an Account_Switch_Event occurs, THE Account_Manager SHALL update the last-active timestamp for the new account in the Account_Registry.
7. IF a sync is already in progress for the previous account when an Account_Switch_Event occurs, THEN THE Sync_Engine SHALL cancel the in-progress sync, persist the current cursor position for the previous account, and then proceed with the full sync for the new Active_Account.
8. WHEN a full sync completes successfully, THE Sync_Engine SHALL remove the progress indicator and display a completion state indicating the total number of bookmarks synced.

### Requirement 5: Existing Data Preservation on Switch

**User Story:** As a user, I want my previously synced data to remain intact when I switch away from an account, so that I do not lose data when switching back.

#### Acceptance Criteria

1. WHEN an Account_Switch_Event occurs, THE Data_Context SHALL retain all IndexedDB records belonging to the previous Active_Account without modification and SHALL NOT delete, overwrite, or alter any record where Owner_ID matches the previous Active_Account.
2. WHEN an Account_Switch_Event occurs, THE Data_Context SHALL retain all Chrome Storage entries namespaced to the previous Active_Account without modification and SHALL NOT remove or overwrite any key matching the `user:{previous_owner_id}:*` namespace.
3. WHEN a user switches back to a previously used account, THE Data_Context SHALL make that account's existing IndexedDB records and Chrome Storage entries queryable and available for UI display within 1 second of the Account_Switch_Event completing, while the Sync_Engine begins a background sync for new data.
4. IF the background sync on switch-back detects that a bookmark has been removed on the server, THEN THE Sync_Engine SHALL remove the corresponding local IndexedDB record to reflect the current server state.

### Requirement 6: Account-Aware UI

**User Story:** As a user, I want to see which account is currently active in the extension UI, so that I have confidence the correct data is displayed.

#### Acceptance Criteria

1. THE Sidebar SHALL display the Active_Account's profile image (rendered at 32×32 pixels) and screen name (truncated with ellipsis if exceeding 20 characters) in an account indicator area positioned at the top of the Sidebar.
2. WHEN the Active_Account changes, THE Sidebar SHALL update the account indicator to reflect the new Active_Account within 2 seconds.
3. WHEN the Active_Account is empty (no account detected), THE Sidebar SHALL hide the account indicator and display a message prompting the user to log in to X/Twitter.
4. WHILE a full sync is in progress for the Active_Account, THE Sidebar SHALL display a sync status badge next to the account indicator showing that syncing is active.
5. WHEN the full sync completes or is halted for the Active_Account, THE Sidebar SHALL remove the sync status badge within 2 seconds.
6. IF the Active_Account's profile image fails to load, THEN THE Sidebar SHALL display a fallback placeholder icon in place of the profile image.

### Requirement 7: Account Data Cleanup

**User Story:** As a user, I want to be able to remove a stored account and its data, so that I can free up storage space and manage my privacy.

#### Acceptance Criteria

1. WHEN a user requests deletion of a registered account from the Account_Registry, THE Account_Manager SHALL present a confirmation prompt before proceeding with any removal.
2. WHEN the user confirms account deletion, THE Account_Manager SHALL remove the account entry from the Account_Registry and then delete all associated data (IndexedDB records and Chrome Storage entries) as a single logical operation.
3. WHEN a user confirms deletion of an account's data, THE Data_Context SHALL delete all IndexedDB records where Owner_ID matches the target account's user ID.
4. WHEN a user confirms deletion of an account's data, THE Data_Context SHALL remove all Chrome Storage entries namespaced to the target account's user ID using the key format `user:{owner_id}:{key}`.
5. IF the user attempts to delete the currently Active_Account (registry entry or data), THEN THE Account_Manager SHALL reject the operation, preserve all data unchanged, and display an error indicating the active account cannot be deleted.
6. IF deletion of IndexedDB records succeeds but Chrome Storage removal fails (or vice versa), THEN THE Account_Manager SHALL report a partial failure to the user indicating which store could not be cleaned, and SHALL NOT remove the account from the Account_Registry.
7. WHEN account data deletion completes successfully, THE Account_Manager SHALL display a visible confirmation message indicating the account and its data have been removed.
