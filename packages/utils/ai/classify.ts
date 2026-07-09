/**
 * Client-side AI classification. The extension calls the user's chosen LLM
 * provider directly with the user's own API key (stored locally) — no Twillot
 * backend involved. Used to auto-sort tweets into existing folders.
 */

import { fetchWithTimeout } from '../fetch-timeout'

export type AIProvider = 'anthropic' | 'openai'

export interface AISettings {
  provider: AIProvider
  apiKey: string
  model: string
}

const AI_SETTINGS_KEY = 'ai_settings'

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
}

export async function getAISettings(): Promise<AISettings> {
  const stored = (await chrome.storage.local.get(AI_SETTINGS_KEY))[
    AI_SETTINGS_KEY
  ] as Partial<AISettings> | undefined
  const provider = (stored?.provider as AIProvider) || 'anthropic'
  return {
    provider,
    apiKey: stored?.apiKey || '',
    model: stored?.model || DEFAULT_MODELS[provider],
  }
}

export async function setAISettings(settings: AISettings): Promise<void> {
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings })
}

function buildPrompt(text: string, folders: string[]): string {
  return [
    'You organize saved tweets into folders.',
    'Given the tweet text and a list of existing folder names, choose the single',
    'folder that best fits. Respond with ONLY the exact folder name, nothing else.',
    'If none fit well, respond with the single word: NONE',
    '',
    `Folders: ${folders.join(', ')}`,
    '',
    `Tweet: ${text.slice(0, 2000)}`,
  ].join('\n')
}

function normalize(answer: string, folders: string[]): string {
  const trimmed = (answer || '').trim()
  if (!trimmed || /^none$/i.test(trimmed)) {
    return ''
  }
  // Exact match first, then case-insensitive.
  const exact = folders.find((f) => f === trimmed)
  if (exact) return exact
  const ci = folders.find((f) => f.toLowerCase() === trimmed.toLowerCase())
  return ci || ''
}

async function classifyAnthropic(
  text: string,
  folders: string[],
  settings: AISettings,
): Promise<string> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      // Required to allow calling the API from a browser extension context.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 20,
      messages: [{ role: 'user', content: buildPrompt(text, folders) }],
    }),
  })
  if (res.status === 429) {
    throw new RateLimitedError()
  }
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}`)
  }
  const json = await res.json()
  const answer = json?.content?.[0]?.text || ''
  return normalize(answer, folders)
}

async function classifyOpenAI(
  text: string,
  folders: string[],
  settings: AISettings,
): Promise<string> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 20,
      messages: [{ role: 'user', content: buildPrompt(text, folders) }],
    }),
  })
  if (res.status === 429) {
    throw new RateLimitedError()
  }
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}`)
  }
  const json = await res.json()
  const answer = json?.choices?.[0]?.message?.content || ''
  return normalize(answer, folders)
}

// ---------------------------------------------------------------------------
// Summarization — a short one-line gist, persisted onto the tweet and written
// into note frontmatter by the Obsidian exporters.
// ---------------------------------------------------------------------------

export interface TweetSummary {
  summary: string
  keywords: string[]
}

function buildSummaryPrompt(text: string): string {
  return [
    'Summarize the following tweet and extract keyword tags.',
    'Respond with ONLY a JSON object, no code fence, of the form:',
    '{"summary": "one concise sentence, max 30 words", "keywords": ["tag1", "tag2"]}',
    'Give 3-5 lowercase keyword tags (single words or short phrases).',
    '',
    `Tweet: ${text.slice(0, 4000)}`,
  ].join('\n')
}

function cleanSummary(s: string): string {
  return (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim()
}

/** Normalize one keyword into an Obsidian-safe tag token. */
function tagifyKeyword(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^#+/, '')
    .slice(0, 40)
}

/**
 * Parse the model's summary+keywords response. Tolerates code fences and
 * non-JSON fallbacks (whole text becomes the summary). Exported for testing.
 */
export function parseSummaryResponse(raw: string): TweetSummary {
  const stripped = (raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let summary = ''
  let keywords: string[] = []
  try {
    const obj = JSON.parse(stripped)
    summary = cleanSummary(String(obj?.summary ?? ''))
    if (Array.isArray(obj?.keywords)) {
      keywords = obj.keywords.map((k: unknown) => String(k))
    }
  } catch {
    // Not JSON — treat the whole thing as the summary.
    summary = cleanSummary(stripped)
  }

  const seen = new Set<string>()
  const cleanKeywords: string[] = []
  for (const k of keywords) {
    const tag = tagifyKeyword(k)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      cleanKeywords.push(tag)
    }
  }
  return { summary, keywords: cleanKeywords.slice(0, 6) }
}

async function summarizeAnthropic(
  text: string,
  settings: AISettings,
): Promise<TweetSummary> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 200,
      messages: [{ role: 'user', content: buildSummaryPrompt(text) }],
    }),
  })
  if (res.status === 429) throw new RateLimitedError()
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`)
  const json = await res.json()
  return parseSummaryResponse(json?.content?.[0]?.text || '')
}

async function summarizeOpenAI(
  text: string,
  settings: AISettings,
): Promise<TweetSummary> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 200,
      messages: [{ role: 'user', content: buildSummaryPrompt(text) }],
    }),
  })
  if (res.status === 429) throw new RateLimitedError()
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}`)
  const json = await res.json()
  return parseSummaryResponse(json?.choices?.[0]?.message?.content || '')
}

/**
 * Produce a one-line summary plus keyword tags for a tweet. Empty fields if the
 * model gives nothing. Throws RateLimitedError on 429, or Error('missing-api-key').
 */
export async function summarizeTweet(params: {
  text: string
  settings: AISettings
}): Promise<TweetSummary> {
  const { text, settings } = params
  if (!settings.apiKey) {
    throw new Error('missing-api-key')
  }
  if (settings.provider === 'openai') {
    return summarizeOpenAI(text, settings)
  }
  return summarizeAnthropic(text, settings)
}

export class RateLimitedError extends Error {
  constructor() {
    super('AI provider rate limited')
    this.name = 'RateLimitedError'
  }
}

/**
 * Classify a tweet into one of the given folders. Returns the chosen folder
 * name, or '' if none fit. Throws RateLimitedError on 429.
 */
export async function classifyTweet(params: {
  text: string
  folders: string[]
  settings: AISettings
}): Promise<string> {
  const { text, folders, settings } = params
  if (!settings.apiKey) {
    throw new Error('missing-api-key')
  }
  if (settings.provider === 'openai') {
    return classifyOpenAI(text, folders, settings)
  }
  return classifyAnthropic(text, folders, settings)
}
