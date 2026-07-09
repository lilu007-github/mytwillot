import {
  EntityScope,
  DuplicateFolderError,
  InvalidFolderNameError,
} from '../types/folder'

/**
 * Validates a folder name by trimming whitespace, checking length constraints,
 * and verifying uniqueness within the given scope.
 *
 * @returns The trimmed name on success, or an Error instance on failure.
 */
export function validateFolderName(
  name: string,
  scope: EntityScope,
  existingNames: string[],
): string | Error {
  const trimmed = name.trim()

  if (trimmed.length === 0) {
    return new InvalidFolderNameError('Folder name cannot be empty')
  }

  if (trimmed.length > 50) {
    return new InvalidFolderNameError(
      'Folder name must be 50 characters or fewer',
    )
  }

  if (existingNames.includes(trimmed)) {
    return new DuplicateFolderError(trimmed, scope)
  }

  return trimmed
}
