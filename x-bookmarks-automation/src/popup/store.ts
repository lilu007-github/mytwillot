import { createStore } from 'solid-js/store'

export const defaultState = () => ({
  like: true,
  repost: true,
  reply: false,
  reply_text: '',
  webhook: false,
  webhook_url: '',
  webhook_token: '',
  saved: false,
})

export default createStore(defaultState())
