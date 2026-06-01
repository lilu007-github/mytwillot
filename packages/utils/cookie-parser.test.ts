import { describe, it, expect } from 'vitest'
import { parseTwidCookie } from './cookie-parser'

describe('parseTwidCookie', () => {
  it('should extract numeric user ID from valid twid cookie value', () => {
    expect(parseTwidCookie('u%3D123456789')).toBe('123456789')
  })

  it('should handle large numeric IDs', () => {
    expect(parseTwidCookie('u%3D9999999999999999')).toBe('9999999999999999')
  })

  it('should return empty string for undefined', () => {
    expect(parseTwidCookie(undefined)).toBe('')
  })

  it('should return empty string for null', () => {
    expect(parseTwidCookie(null)).toBe('')
  })

  it('should return empty string for empty string', () => {
    expect(parseTwidCookie('')).toBe('')
  })

  it('should return empty string when prefix is missing', () => {
    expect(parseTwidCookie('123456789')).toBe('')
  })

  it('should return empty string for non-numeric value after prefix', () => {
    expect(parseTwidCookie('u%3Dabc')).toBe('')
  })

  it('should return empty string for mixed alphanumeric after prefix', () => {
    expect(parseTwidCookie('u%3D123abc')).toBe('')
  })

  it('should return empty string when prefix is present but no value follows', () => {
    expect(parseTwidCookie('u%3D')).toBe('')
  })

  it('should return empty string for value with spaces after prefix', () => {
    expect(parseTwidCookie('u%3D 123')).toBe('')
  })

  it('should return empty string for value with special characters', () => {
    expect(parseTwidCookie('u%3D123-456')).toBe('')
  })
})
