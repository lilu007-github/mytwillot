/**
 * Supported formats of exporting.
 */
export const EXPORT_FORMAT = {
  JSON: 'JSON',
  HTML: 'HTML',
  CSV: 'CSV',
  MARKDOWN: 'Markdown',
  PDF: 'PDF',
} as const

export type ExportFormatType =
  (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataType = Record<string, any>

/**
 * Escape characters for CSV file.
 */
export function csvEscapeStr(str: string) {
  return `"${str.replace(/"/g, '""').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}

/**
 * Save a text file to disk.
 */
export function saveFile(
  filename: string,
  content: string,
  prependBOM: boolean = false,
) {
  const link = document.createElement('a')
  const blob = new Blob(
    prependBOM ? [new Uint8Array([0xef, 0xbb, 0xbf]), content] : [content],
    {
      type: 'text/plain;charset=utf-8',
    },
  )
  const url = URL.createObjectURL(blob)

  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Export data and download as a file.
 *
 * @param data Data list to export.
 * @param format Export format. (JSON, HTML, CSV)
 * @param filename Filename to save.
 * @param translations Translations for headers.
 */
export async function exportData(
  data: DataType[],
  format: ExportFormatType,
  filename: string,
  translations?: Record<string, string>,
) {
  try {
    let content = ''
    let prependBOM = false

    switch (format) {
      case EXPORT_FORMAT.JSON:
        content = await jsonExporter(data)
        break
      case EXPORT_FORMAT.HTML:
        content = await htmlExporter(data, translations)
        break
      case EXPORT_FORMAT.CSV:
        prependBOM = true
        content = await csvExporter(data, translations)
        break
      case EXPORT_FORMAT.MARKDOWN:
        content = await markdownExporter(data)
        break
      case EXPORT_FORMAT.PDF:
        // Rendered client-side via the browser's print-to-PDF.
        printHtml(await htmlExporter(data, translations))
        return
    }
    saveFile(filename, content, prependBOM)
  } catch (err) {}
}

/**
 * Render rows as Markdown. Tweet-shaped rows (with full_text) get a readable
 * block; anything else falls back to a key/value list.
 */
export async function markdownExporter(data: DataType[]) {
  const escape = (s: string) => String(s ?? '').replace(/\r?\n/g, '\n')

  const blocks = data.map((row) => {
    if ('full_text' in row) {
      const lines: string[] = []
      const who = row.username || row.screen_name || ''
      const handle = row.screen_name ? `@${row.screen_name}` : ''
      lines.push(`### ${who} ${handle}`.trim())
      if (row.created_at) {
        lines.push(`*${row.created_at}*`)
      }
      lines.push('')
      lines.push(escape(row.full_text))
      if (row.url) {
        lines.push('')
        lines.push(`[View on X](${row.url})`)
      }
      const media = row.media || row.media_items
      if (Array.isArray(media) && media.length > 0) {
        lines.push('')
        for (const m of media) {
          const src = m.original || m.media_url || m.media_url_https || ''
          if (src) lines.push(`![media](${src})`)
        }
      }
      return lines.join('\n')
    }
    return Object.entries(row)
      .map(([k, v]) => `- **${k}**: ${escape(typeof v === 'string' ? v : JSON.stringify(v))}`)
      .join('\n')
  })

  return blocks.join('\n\n---\n\n') + '\n'
}

/**
 * Open the export HTML in a new window and invoke the print dialog so the user
 * can "Save as PDF". Zero-dependency PDF export.
 */
export function printHtml(html: string) {
  const win = window.open('', '_blank')
  if (!win) {
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  // Give the browser a tick to lay out before printing.
  setTimeout(() => {
    win.focus()
    win.print()
  }, 500)
}

export async function jsonExporter(data: DataType[]) {
  return JSON.stringify(data, undefined, '  ')
}

export async function htmlExporter(
  data: DataType[],
  translations: Record<string, string>,
) {
  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const tbody = document.createElement('tbody')

  // The keys of the first row are translated and used as headers.
  const exportKeys = Object.keys(data[0] ?? {})
  const headerRow = document.createElement('tr')
  for (const exportKey of exportKeys) {
    const th = document.createElement('th')
    th.textContent = translations[exportKey] ?? exportKey
    headerRow.appendChild(th)
  }

  thead.appendChild(headerRow)
  table.appendChild(thead)
  table.className = 'table table-striped'

  for (const row of data) {
    const tr = document.createElement('tr')
    for (const exportKey of exportKeys) {
      const td = document.createElement('td')
      const value = row[exportKey]

      if (
        exportKey === 'profile_image_url' ||
        exportKey === 'profile_banner_url'
      ) {
        const img = document.createElement('img')
        img.src = value
        img.width = 50
        td.innerHTML = ''
        td.appendChild(img)
      } else if (exportKey === 'media') {
        if (value?.length > 0) {
          for (const media of value) {
            const img = document.createElement('img')
            img.src = media.thumbnail
            img.width = 50
            img.alt = media.ext_alt_text || ''
            img.title = media.ext_alt_text || ''
            const link = document.createElement('a')
            link.href = media.original
            link.target = '_blank'
            link.style.marginRight = '0.5em'
            link.appendChild(img)
            td.appendChild(link)
          }
        }
      } else if (exportKey === 'full_text' || exportKey === 'description') {
        const p = document.createElement('p')
        p.innerHTML = value
        p.style.whiteSpace = 'pre-wrap'
        p.style.maxWidth = '640px'
        td.appendChild(p)
      } else if (exportKey === 'metadata') {
        const details = document.createElement('details')
        const summary = document.createElement('summary')
        summary.textContent = 'Expand'
        details.appendChild(summary)
        const pre = document.createElement('pre')
        pre.textContent = JSON.stringify(value, undefined, '  ')
        details.appendChild(pre)
        td.appendChild(details)
      } else if (exportKey === 'url') {
        const link = document.createElement('a')
        link.href = value
        link.target = '_blank'
        link.textContent = value
        td.appendChild(link)
      } else {
        td.textContent =
          typeof value === 'string' ? value : JSON.stringify(row[exportKey])
      }

      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }

  table.appendChild(tbody)

  return `
    <html>
      <head>
        <meta charset="utf-8">
        <title>Exported Data ${new Date().toISOString()}</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
      </head>
      <body>
        ${table.outerHTML}
      </body>
    </html>
  `
}

export async function csvExporter<T extends Record<string, any>>(
  data: T[],
  translations?: Record<string, string>,
) {
  const headers = translations
    ? Object.keys(translations)
    : Object.keys(data[0] || {})
  let content =
    (translations ? Object.values(translations) : headers).join(',') + '\n'

  for (const row of data) {
    const values = headers.map((header) => {
      const value = row[header]
      if (typeof value === 'string') {
        return csvEscapeStr(value)
      }

      if (typeof value === 'object') {
        return csvEscapeStr(JSON.stringify(value))
      }

      return value
    })
    content += values.join(',')
    content += '\n'
  }

  return content
}
