import { getActiveAccountId } from '../account-manager'

export class NoActiveAccountError extends Error {
  constructor() {
    super('No active account detected')
    this.name = 'NoActiveAccountError'
  }
}

export class OwnershipMismatchError extends Error {
  constructor() {
    super("Cannot write to another account's data")
    this.name = 'OwnershipMismatchError'
  }
}

/**
 * Get the current owner_id, throws if empty/null/undefined.
 */
export async function requireActiveAccount(): Promise<string> {
  const accountId = await getActiveAccountId()
  if (!accountId) {
    throw new NoActiveAccountError()
  }
  return accountId
}

/**
 * Validate that a record's owner_id matches the active account.
 * Throws OwnershipMismatchError if they don't match.
 */
export async function validateOwnership(recordOwnerId: string): Promise<void> {
  const activeId = await requireActiveAccount()
  if (recordOwnerId !== activeId) {
    throw new OwnershipMismatchError()
  }
}

/**
 * Wrap a DB operation with ownership validation.
 * Calls requireActiveAccount() first, then executes the operation.
 */
export async function withOwnershipCheck<T>(
  operation: () => Promise<T>,
): Promise<T> {
  await requireActiveAccount()
  return operation()
}
