import { parseTwidCookie } from 'utils/cookie-parser'
import { detectAndSetActiveAccount } from 'utils/account-manager'

const cookies = document.cookie.split(';')
const twidCookie = cookies.find((c) => c.trim().startsWith('twid='))
const twidValue = twidCookie?.split('=').slice(1).join('=')?.trim()
const userId = parseTwidCookie(twidValue)

detectAndSetActiveAccount(userId)
