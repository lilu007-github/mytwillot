/**
 * MCP server (stdio) over the agent mirror. Read-only: agents search,
 * summarize and propose organization; changes are made in the extension.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { AgentTweet } from 'utils/agent-mirror'

import { createDatasetLoader, loadIndex } from './data'
import { getTweets, searchTweets } from './query'
import { stats, trends } from './trends'

const CATEGORY = z
  .enum(['all', 'bookmarks', 'likes', 'posts', 'replies', 'media'])
  .optional()
  .describe(
    'Data type; default all (a tweet both bookmarked and liked appears once)',
  )

const FILTERS = {
  category: CATEGORY,
  folder: z
    .string()
    .optional()
    .describe('Folder path, case-insensitive; "AI" also matches "AI/LLM"'),
  unsorted: z.boolean().optional().describe('Only items not in any folder'),
  tag: z.string().optional(),
  untagged: z.boolean().optional().describe('Only items without tags'),
  author: z.string().optional().describe('Author screen name'),
  since: z
    .string()
    .optional()
    .describe('Relative (7d, 2w, 3m, 1y) or absolute (2026-01-01, 2026-01)'),
  until: z.string().optional().describe('Same formats as since; inclusive'),
  has: z.enum(['media', 'link', 'thread', 'quote']).optional(),
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false }

function result(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** Search hits: enough to judge relevance; get_tweets has everything. */
function brief(t: AgentTweet, full: boolean) {
  return {
    id: t.id,
    url: t.url,
    category: t.category,
    created_at: t.created_at,
    author: t.author.screen_name,
    folder: t.folder,
    tags: t.tags,
    ...(t.ai_summary ? { ai_summary: t.ai_summary } : {}),
    text: full ? t.text : clip(t.text, 500),
    ...(full
      ? { thread: t.thread }
      : t.thread.length
        ? { thread_length: t.thread.length }
        : {}),
    ...(t.quoted
      ? {
          quoted: {
            author: t.quoted.author,
            text: full ? t.quoted.text : clip(t.quoted.text, 200),
          },
        }
      : {}),
    likes: t.metrics.likes,
  }
}

export function createServer(dir: string, account?: string) {
  const load = createDatasetLoader(dir, account)
  const server = new McpServer({ name: 'twillot', version: '0.1.0' })

  server.registerTool(
    'mirror_info',
    {
      title: 'Mirror info',
      description:
        "Which X accounts are mirrored, when the mirror was last refreshed, and item counts. Check this first: data is only as fresh as the extension's last mirror.",
      annotations: READ_ONLY,
    },
    async () => {
      const ds = load()
      return result({
        active_account: ds.account,
        accounts: loadIndex(dir).accounts,
        folders: ds.folders.length,
        tags: ds.tags.length,
      })
    },
  )

  server.registerTool(
    'search_tweets',
    {
      title: 'Search saved tweets',
      description:
        'Search the user\'s saved X bookmarks / likes / posts. Query: space-separated terms (all must match, case-insensitive substring over text, thread, quoted tweet, author, folder, tags, AI summary), "quoted phrases", -excluded, from:user, since:/until:. Empty query lists by filters. Texts are clipped unless full=true; use get_tweets for complete items.',
      inputSchema: {
        query: z.string().optional(),
        ...FILTERS,
        sort: z
          .enum(['relevance', 'date', 'engagement'])
          .optional()
          .describe(
            'Default: relevance with a query, else date (newest first)',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Default 20'),
        offset: z.number().int().min(0).optional(),
        full: z.boolean().optional().describe('Include full text and threads'),
      },
      annotations: READ_ONLY,
    },
    async ({ full, ...opts }) => {
      const res = searchTweets(load().tweets, opts)
      return result({
        total: res.total,
        offset: res.offset,
        returned: res.items.length,
        items: res.items.map((t) => brief(t, !!full)),
      })
    },
  )

  server.registerTool(
    'get_tweets',
    {
      title: 'Get tweets',
      description:
        'Full records (text, whole thread, quoted tweet, media, metrics, folder, tags, AI summary, note) for tweet ids or x.com status URLs.',
      inputSchema: {
        ids: z.array(z.string()).min(1).max(200),
      },
      annotations: READ_ONLY,
    },
    async ({ ids }) => result(getTweets(load().tweets, ids)),
  )

  server.registerTool(
    'list_folders',
    {
      title: 'List folders',
      description: 'Bookmark folders with full paths and item counts.',
      annotations: READ_ONLY,
    },
    async () => result(load().folders),
  )

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'User tags with item counts.',
      annotations: READ_ONLY,
    },
    async () => result(load().tags),
  )

  server.registerTool(
    'stats',
    {
      title: 'Statistics',
      description:
        'Totals by category and month, date range, top authors / folders / tags, for the filtered set.',
      inputSchema: {
        ...FILTERS,
        top: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ top, ...filters }) => result(stats(load().tweets, filters, top)),
  )

  server.registerTool(
    'trends',
    {
      title: 'Topic trends',
      description:
        'Per period (week / month / quarter / year): item count, top terms (document frequency, stopwords removed, Chinese and English), hashtags and authors; plus "rising" terms whose share in the latest period is at least 2x their earlier average. Use it to see what the user has been paying attention to and how that shifted.',
      inputSchema: {
        ...FILTERS,
        period: z.enum(['week', 'month', 'quarter', 'year']).optional(),
        top: z.number().int().min(1).max(50).optional().describe('Default 10'),
      },
      annotations: READ_ONLY,
    },
    async (opts) => result(trends(load().tweets, opts)),
  )

  server.registerPrompt(
    'digest',
    {
      title: 'Reading digest',
      description: 'Summarize what was saved in a period, grouped by theme.',
      argsSchema: {
        since: z.string().optional().describe('Default 7d'),
        topic: z
          .string()
          .optional()
          .describe('Optional focus, e.g. "AI agents"'),
      },
    },
    ({ since, topic }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Using the twillot tools, build a digest of what I saved since ${since || '7d'}` +
              (topic ? `, focused on ${topic}` : '') +
              '. Call trends (period week) and search_tweets with full=true (page with offset if needed). ' +
              'Group items into themes; for each theme give the key ideas in 2-4 bullets with links to the source tweets. ' +
              'End with what is new or rising compared with earlier periods, and 3 things worth reading in depth.',
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'organize',
    {
      title: 'Organize unsorted bookmarks',
      description:
        'Propose folders and tags for unsorted bookmarks (read-only: you apply them in the extension).',
      argsSchema: {
        limit: z
          .string()
          .optional()
          .describe('How many unsorted items; default 100'),
      },
    },
    ({ limit }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Using the twillot tools, call list_folders and list_tags, then search_tweets with unsorted=true, category=bookmarks, limit=${limit || '100'}. ` +
              'Assign each item to an existing folder when one fits, otherwise propose a small number of new folders (prefer nesting under existing ones). ' +
              'Output a table: tweet link, one-line gist, proposed folder, proposed tags. Then list any new folders with a one-line purpose each.',
          },
        },
      ],
    }),
  )

  return server
}

export async function runMcpServer(dir: string, account?: string) {
  const server = createServer(dir, account)
  await server.connect(new StdioServerTransport())
}
