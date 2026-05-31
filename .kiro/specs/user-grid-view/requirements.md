# Requirements Document

## Introduction

The User Grid View feature provides a tabular/grid display of Twitter/X user data (followers, following) within the Twillot Exporter Chrome extension. Users can browse their synced user data in a configurable, sortable, and paginated table — without a DM (direct message) column. The grid supports column visibility customization, multi-field sorting, and pagination for efficient navigation of large user datasets stored in IndexedDB.

## Glossary

- **Grid_View**: The tabular UI component that displays user data in rows and columns
- **Column_Configuration**: The user-facing settings panel that controls which columns are visible in the Grid_View
- **Pagination_Control**: The UI component that allows navigation between pages of user data
- **Sort_Indicator**: The visual element on a column header that shows the current sort direction (ascending or descending)
- **StoredUser**: The IndexedDB record representing a synced Twitter/X user with fields such as name, screen_name, followers_count, friends_count, statuses_count, location, is_blue_verified, created_at, and description
- **Page_Size**: The number of user rows displayed per page in the Grid_View
- **Column_Preference**: The persisted user setting that records which columns are shown or hidden

## Requirements

### Requirement 1: Display Users in Grid Layout

**User Story:** As an exporter user, I want to see my synced followers/following displayed in a grid table, so that I can quickly scan and compare user information.

#### Acceptance Criteria

1. WHEN the user navigates to the user grid page, THE Grid_View SHALL render a table with one row per StoredUser record matching the active relationship filter, displaying rows in the order returned by IndexedDB
2. THE Grid_View SHALL display the following default columns in left-to-right order: avatar (rendered as the user's profile_image_url_https thumbnail), name, screen_name, followers_count, friends_count, statuses_count, is_blue_verified, location, description, and created_at
3. THE Grid_View SHALL NOT include a DM (direct message) column
4. WHEN no StoredUser records exist for the active relationship filter, THE Grid_View SHALL display an empty state message indicating no users have been synced
5. IF IndexedDB fails to return user data, THEN THE Grid_View SHALL display an error message indicating that user data could not be loaded and SHALL NOT render partial or stale rows

### Requirement 2: Column Visibility Configuration

**User Story:** As an exporter user, I want to choose which columns are visible in the grid, so that I can focus on the user attributes most relevant to me.

#### Acceptance Criteria

1. THE Column_Configuration SHALL provide a toggle control for each column defined in the Grid_View default columns (avatar, name, screen_name, followers_count, friends_count, statuses_count, is_blue_verified, location, description, and created_at)
2. WHEN the user toggles a column off, THE Grid_View SHALL hide that column immediately without a page reload
3. WHEN the user toggles a column on, THE Grid_View SHALL show that column immediately without a page reload
4. THE Column_Configuration SHALL persist the user's Column_Preference to Chrome storage so that preferences survive extension restarts
5. WHEN the extension loads and a saved Column_Preference exists, THE Grid_View SHALL restore the previously saved column visibility settings
6. WHEN the extension loads and no saved Column_Preference exists, THE Grid_View SHALL display all default columns as visible
7. IF the user attempts to hide the last visible column, THEN THE Column_Configuration SHALL prevent the toggle and keep that column visible
8. WHEN the user changes any column visibility setting, THE Column_Configuration SHALL persist the updated Column_Preference to Chrome storage within 1 second

### Requirement 3: Pagination

**User Story:** As an exporter user, I want to navigate through users page by page, so that I can browse large datasets without performance degradation.

#### Acceptance Criteria

1. THE Pagination_Control SHALL display the current page number and total page count
2. WHEN the user clicks the next page button, THE Grid_View SHALL display the next Page_Size batch of users
3. WHEN the user clicks the previous page button, THE Grid_View SHALL display the previous Page_Size batch of users
4. WHILE the user is on the first page, THE Pagination_Control SHALL disable the previous page button
5. WHILE the user is on the last page, THE Pagination_Control SHALL disable the next page button
6. THE Pagination_Control SHALL default to a Page_Size of 20 rows
7. WHEN the user selects a new Page_Size, THE Pagination_Control SHALL update the Grid_View to display the selected number of rows per page and reset to page one
8. WHEN the total number of users matching the current filters is zero, THE Pagination_Control SHALL be hidden

### Requirement 4: Sorting

**User Story:** As an exporter user, I want to sort the user grid by any visible column, so that I can rank and find users by specific attributes like follower count.

#### Acceptance Criteria

1. WHEN the user clicks a sortable column header, THE Grid_View SHALL sort all user data by that column in ascending order
2. WHEN the user clicks the same column header again, THE Grid_View SHALL reverse the sort direction to descending order
3. WHEN the user clicks the same column header a third time, THE Grid_View SHALL remove the sort and return to the IndexedDB insertion order
4. WHILE a sort is active, THE Sort_Indicator SHALL display an upward arrow for ascending or a downward arrow for descending on the active sort column
5. WHEN sorting is removed, THE Sort_Indicator SHALL not be displayed on any column header
6. WHEN sorting is applied, THE Pagination_Control SHALL reset to page one
7. THE Grid_View SHALL support sorting on numeric columns (followers_count, friends_count, statuses_count), text columns (name, screen_name, location), and date columns (created_at), using case-insensitive comparison for text columns
8. IF the user clicks a column header that is not sortable (avatar, is_blue_verified, description), THEN THE Grid_View SHALL not change the current sort state

### Requirement 5: Batch Selection and Bulk Actions

**User Story:** As an exporter user, I want to select multiple users via checkboxes and perform bulk actions on them, so that I can efficiently manage large groups of users at once.

#### Acceptance Criteria

1. THE Grid_View SHALL display a checkbox column as the first column in each row
2. THE Grid_View SHALL display a header checkbox that selects or deselects all users on the current page; WHILE at least one but not all rows on the current page are selected, THE header checkbox SHALL display an indeterminate state
3. WHEN the user selects one or more rows, THE Grid_View SHALL display a bulk action toolbar above the grid
4. THE bulk action toolbar SHALL include a "Move to Folder" action that, when activated, presents a folder selection list and assigns all selected users to the chosen folder
5. THE bulk action toolbar SHALL include an "Unfollow" action that, when activated, displays a confirmation prompt indicating the number of users to be unfollowed before executing the operation
6. WHEN no rows are selected, THE Grid_View SHALL hide the bulk action toolbar
7. THE bulk action toolbar SHALL display the count of currently selected users
8. WHEN the user navigates to a different page, THE Grid_View SHALL clear the current selection
9. WHEN a bulk action completes, THE Grid_View SHALL display a notification indicating the number of users successfully processed and the number of failures, if any
10. IF a bulk action fails for one or more selected users, THEN THE Grid_View SHALL display an error notification indicating how many users could not be processed and SHALL preserve the selection of the failed rows

### Requirement 6: Relationship Filter

**User Story:** As an exporter user, I want to filter the grid between followers and following, so that I can view each relationship type separately.

#### Acceptance Criteria

1. THE Grid_View SHALL provide a relationship filter with options: "Followers" and "Following"
2. WHEN the user selects a relationship filter, THE Grid_View SHALL display only StoredUser records whose relationship field matches the selected type
3. THE Grid_View SHALL default to displaying "Followers" on initial load
4. WHEN the relationship filter changes, THE Pagination_Control SHALL reset to page one
5. WHEN the relationship filter changes and the selected relationship type has zero matching StoredUser records, THE Grid_View SHALL display an empty state message indicating no users exist for that relationship type
6. WHEN the relationship filter changes, THE Grid_View SHALL clear any active row selections and hide the bulk action toolbar

### Requirement 7: Keyword Search

**User Story:** As an exporter user, I want to search users by name, screen name, or description, so that I can quickly find specific users in a large dataset.

#### Acceptance Criteria

1. WHEN the user enters a keyword of at least 1 non-whitespace character in the search field, THE Grid_View SHALL filter displayed users to those whose name, screen_name, or description contains the keyword as a case-insensitive substring match
2. WHEN the search field is cleared or contains only whitespace, THE Grid_View SHALL display all users matching the current relationship filter
3. WHEN a search keyword is applied, THE Pagination_Control SHALL reset to page one
4. THE Grid_View SHALL apply the search filter with a debounce delay of 300 milliseconds to avoid excessive IndexedDB queries
5. THE Grid_View SHALL accept a keyword up to 100 characters in length and ignore any characters beyond that limit
6. WHEN a search keyword matches zero users, THE Grid_View SHALL display an empty state message indicating no users match the search criteria
