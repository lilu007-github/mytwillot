import { describe, it, expect, beforeEach } from 'vitest'
import browser from 'webextension-polyfill'

import {
  requireActiveAccount,
  validateOwnership,
  withOwnershipCheck,
  NoActiveAccountError,
  OwnershipMismatchError,
} from './context-guard'
import { setCurrentUserId } from '../storage'

describe('context-guard', () => {
  beforeEach(async () => {
    global.chrome = browser
  })

  describe('requireActiveAccount', () => {
    it('returns the active account ID when set', async () => {
      await setCurrentUserId('12345')
      const result = await requireActiveAccount()
      expect(result).toBe('12345')
    })

    it('throws NoActiveAccountError when account ID is empty string', async () => {
      await setCurrentUserId('')
      await expect(requireActiveAccount()).rejects.toThrow(
        NoActiveAccountError,
      )
      await expect(requireActiveAccount()).rejects.toThrow(
        'No active account detected',
      )
    })

    it('throws NoActiveAccountError when account ID is not set', async () => {
      await chrome.storage.local.clear()
      await expect(requireActiveAccount()).rejects.toThrow(
        NoActiveAccountError,
      )
    })
  })

  describe('validateOwnership', () => {
    it('does not throw when record owner matches active account', async () => {
      await setCurrentUserId('12345')
      await expect(validateOwnership('12345')).resolves.toBeUndefined()
    })

    it('throws OwnershipMismatchError when record owner differs from active account', async () => {
      await setCurrentUserId('12345')
      await expect(validateOwnership('99999')).rejects.toThrow(
        OwnershipMismatchError,
      )
      await expect(validateOwnership('99999')).rejects.toThrow(
        "Cannot write to another account's data",
      )
    })

    it('throws NoActiveAccountError when no active account is set', async () => {
      await setCurrentUserId('')
      await expect(validateOwnership('12345')).rejects.toThrow(
        NoActiveAccountError,
      )
    })
  })

  describe('withOwnershipCheck', () => {
    it('executes the operation when active account exists', async () => {
      await setCurrentUserId('12345')
      const result = await withOwnershipCheck(async () => 'success')
      expect(result).toBe('success')
    })

    it('throws NoActiveAccountError before executing operation when no active account', async () => {
      await setCurrentUserId('')
      let operationCalled = false
      await expect(
        withOwnershipCheck(async () => {
          operationCalled = true
          return 'should not reach'
        }),
      ).rejects.toThrow(NoActiveAccountError)
      expect(operationCalled).toBe(false)
    })

    it('propagates errors from the wrapped operation', async () => {
      await setCurrentUserId('12345')
      await expect(
        withOwnershipCheck(async () => {
          throw new Error('DB failure')
        }),
      ).rejects.toThrow('DB failure')
    })
  })

  describe('error classes', () => {
    it('NoActiveAccountError has correct name and message', () => {
      const error = new NoActiveAccountError()
      expect(error.name).toBe('NoActiveAccountError')
      expect(error.message).toBe('No active account detected')
      expect(error).toBeInstanceOf(Error)
    })

    it('OwnershipMismatchError has correct name and message', () => {
      const error = new OwnershipMismatchError()
      expect(error.name).toBe('OwnershipMismatchError')
      expect(error.message).toBe("Cannot write to another account's data")
      expect(error).toBeInstanceOf(Error)
    })
  })
})
