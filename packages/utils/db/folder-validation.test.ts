import { describe, it, expect } from 'vitest'

import { validateFolderName } from './folder-validation'
import {
  DuplicateFolderError,
  InvalidFolderNameError,
} from '../types/folder'

describe('validateFolderName', () => {
  it('should return trimmed name for valid input', () => {
    const result = validateFolderName('  My Folder  ', 'bookmark', [])
    expect(result).toBe('My Folder')
  })

  it('should accept a name with exactly 1 character', () => {
    const result = validateFolderName('A', 'bookmark', [])
    expect(result).toBe('A')
  })

  it('should accept a name with exactly 50 characters', () => {
    const name = 'a'.repeat(50)
    const result = validateFolderName(name, 'user', [])
    expect(result).toBe(name)
  })

  it('should return InvalidFolderNameError for empty string', () => {
    const result = validateFolderName('', 'bookmark', [])
    expect(result).toBeInstanceOf(InvalidFolderNameError)
    expect((result as Error).message).toBe('Folder name cannot be empty')
  })

  it('should return InvalidFolderNameError for whitespace-only string', () => {
    const result = validateFolderName('   ', 'user', [])
    expect(result).toBeInstanceOf(InvalidFolderNameError)
    expect((result as Error).message).toBe('Folder name cannot be empty')
  })

  it('should return InvalidFolderNameError for name exceeding 50 characters', () => {
    const name = 'a'.repeat(51)
    const result = validateFolderName(name, 'bookmark', [])
    expect(result).toBeInstanceOf(InvalidFolderNameError)
    expect((result as Error).message).toBe(
      'Folder name must be 50 characters or fewer',
    )
  })

  it('should return InvalidFolderNameError when trimmed name exceeds 50 characters', () => {
    const name = '  ' + 'a'.repeat(51) + '  '
    const result = validateFolderName(name, 'bookmark', [])
    expect(result).toBeInstanceOf(InvalidFolderNameError)
    expect((result as Error).message).toBe(
      'Folder name must be 50 characters or fewer',
    )
  })

  it('should return DuplicateFolderError when name exists in existingNames', () => {
    const result = validateFolderName('Work', 'bookmark', ['Work', 'Personal'])
    expect(result).toBeInstanceOf(DuplicateFolderError)
  })

  it('should return DuplicateFolderError when trimmed name matches existing', () => {
    const result = validateFolderName('  Work  ', 'user', ['Work', 'Personal'])
    expect(result).toBeInstanceOf(DuplicateFolderError)
  })

  it('should not flag duplicate when name differs by case', () => {
    const result = validateFolderName('work', 'bookmark', ['Work'])
    expect(result).toBe('work')
  })

  it('should handle unicode and emoji names', () => {
    const result = validateFolderName('📁 Favorites', 'bookmark', [])
    expect(result).toBe('📁 Favorites')
  })
})
