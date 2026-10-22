import type { AgentTweet } from 'utils/agent-mirror'

export type Format = 'text' | 'md' | 'json'

function date(iso: string) {
  return iso.slice(0, 10)
}

function labels(t: AgentTweet) {
  return [t.category, t.folder, ...t.tags.map((x) => `#${x}`)].filter(Boolean)
}

function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** One compact block per tweet, for terminals. */
export function tweetsText(items: AgentTweet[], full = false): string {
  return items
    .map((t) => {
      const head = `${date(t.created_at)}  @${t.author.screen_name}  [${labels(t).join(' · ')}]  ${t.id}`
      const body = full
        ? [t.text, ...t.thread].join('\n\n')
        : clip(t.text, 280) +
          (t.thread.length ? ` (+${t.thread.length} in thread)` : '')
      const quoted = t.quoted
        ? `\n  ↳ @${t.quoted.author}: ${full ? t.quoted.text : clip(t.quoted.text, 160)}`
        : ''
      const summary = t.ai_summary ? `\n  ✦ ${t.ai_summary}` : ''
      return `${head}\n  ${body.replace(/\n/g, '\n  ')}${quoted}${summary}\n  ${t.url}`
    })
    .join('\n\n')
}

/** Markdown, full text — ready to paste into notes or an LLM prompt. */
export function tweetsMarkdown(items: AgentTweet[]): string {
  return items
    .map((t) => {
      const quote = (s: string) =>
        s
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n')
      const parts = [
        `### @${t.author.screen_name} · ${date(t.created_at)}`,
        quote([t.text, ...t.thread].join('\n\n')),
      ]
      if (t.quoted) {
        parts.push(`Quoting @${t.quoted.author}:\n\n${quote(t.quoted.text)}`)
      }
      const meta = labels(t).join(' · ')
      parts.push(`${meta ? meta + ' · ' : ''}[link](${t.url})`)
      return parts.join('\n\n')
    })
    .join('\n\n---\n\n')
}

export function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

/** Fixed-width two-column table of key/count rows. */
export function countsTable(rows: { key: string; count: number }[]) {
  const width = Math.max(0, ...rows.map((r) => String(r.count).length))
  return rows
    .map((r) => `${String(r.count).padStart(width)}  ${r.key}`)
    .join('\n')
}
