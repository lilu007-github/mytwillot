import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@solidjs/testing-library'

import AccountIndicator, {
  type AccountIndicatorProps,
} from './AccountIndicator'

const baseProps: AccountIndicatorProps = {
  userId: '123',
  screenName: 'jack',
  profileImageUrl: 'https://pbs.twimg.com/profile_images/jack.jpg',
  syncStatus: 'idle',
}

describe('AccountIndicator', () => {
  afterEach(cleanup)

  it('renders the profile image and screen name for a valid account', () => {
    const { getByAltText, getByText } = render(() => (
      <AccountIndicator {...baseProps} />
    ))
    const img = getByAltText('@jack') as HTMLImageElement
    expect(img.src).toBe(baseProps.profileImageUrl)
    expect(img.width).toBe(32)
    expect(img.height).toBe(32)
    expect(getByText('jack')).toBeTruthy()
  })

  it('truncates screen names longer than 20 characters with an ellipsis', () => {
    const { getByText } = render(() => (
      <AccountIndicator {...baseProps} screenName={'a'.repeat(25)} />
    ))
    expect(getByText('a'.repeat(20) + '…')).toBeTruthy()
  })

  it('shows the sync badge with progress only while syncing', () => {
    const { container, getByText, unmount } = render(() => (
      <AccountIndicator {...baseProps} syncStatus="syncing" syncProgress={42} />
    ))
    expect(getByText('42')).toBeTruthy()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    unmount()

    for (const syncStatus of ['idle', 'error'] as const) {
      const { container: c, unmount: u } = render(() => (
        <AccountIndicator
          {...baseProps}
          syncStatus={syncStatus}
          syncProgress={42}
        />
      ))
      expect(c.querySelector('.animate-spin')).toBeNull()
      expect(c.textContent).not.toContain('42')
      u()
    }
  })

  it('falls back to the placeholder icon when the image fails to load', async () => {
    const { container, getByAltText } = render(() => (
      <AccountIndicator {...baseProps} />
    ))
    fireEvent.error(getByAltText('@jack'))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows the placeholder when no profile image url is set', () => {
    const { container } = render(() => (
      <AccountIndicator {...baseProps} profileImageUrl="" />
    ))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('hides the indicator and shows a login prompt when no account is detected', () => {
    const { container, getByText } = render(() => (
      <AccountIndicator {...baseProps} userId="" syncStatus="syncing" />
    ))
    expect(getByText('Log in to X/Twitter')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toContain('jack')
  })
})
