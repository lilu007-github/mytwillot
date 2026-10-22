import { describe, it, expect } from 'vitest'

import {
  columnName,
  sheetXml,
  xlsxEntries,
  xmlText,
  XLSX_MAX_CELL_CHARS,
} from './xlsx'

describe('columnName', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('%i → %s', (index, name) => {
    expect(columnName(index)).toBe(name)
  })
})

describe('xmlText', () => {
  it('escapes markup and drops characters XML cannot hold', () => {
    expect(xmlText('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
    expect(xmlText('x\u0000\u0007y\tz\n')).toBe('xy\tz\n')
    // Lone surrogates are dropped, real pairs (emoji) are kept.
    expect(xmlText('\uD83D ok \uDE00 😀')).toBe(' ok  😀')
  })
})

describe('sheetXml', () => {
  it('writes a header row from the column labels, then one row per record', () => {
    const xml = sheetXml(
      [{ id: '1', text: 'hi', n: 3, ok: true, extra: 'ignored' }],
      { id: 'ID', text: 'Text', n: 'Count', ok: 'OK' },
    )
    expect(xml).toContain(
      '<row r="1">' +
        '<c r="A1" t="inlineStr"><is><t xml:space="preserve">ID</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t xml:space="preserve">Text</t></is></c>' +
        '<c r="C1" t="inlineStr"><is><t xml:space="preserve">Count</t></is></c>' +
        '<c r="D1" t="inlineStr"><is><t xml:space="preserve">OK</t></is></c>' +
        '</row>',
    )
    expect(xml).toContain('<c r="C2"><v>3</v></c>')
    expect(xml).toContain('<c r="D2" t="b"><v>1</v></c>')
    expect(xml).not.toContain('ignored')
  })

  it('keeps multi-line text in one cell, serializes objects, skips empties', () => {
    const xml = sheetXml([
      { a: 'line1\nline2', b: { x: 1 }, c: null, d: undefined, e: NaN },
    ])
    expect(xml).toContain('line1\nline2')
    expect(xml).toContain('{&quot;x&quot;:1}')
    expect(xml).not.toContain('r="C2"')
    expect(xml).not.toContain('r="D2"')
    // Non-finite numbers are not valid <v> values; written as text.
    expect(xml).toContain('<c r="E2" t="inlineStr">')
  })

  it('truncates text to Excel’s per-cell limit', () => {
    const xml = sheetXml([{ a: 'x'.repeat(XLSX_MAX_CELL_CHARS + 10) }])
    const text = xml.match(/<t xml:space="preserve">(x+)<\/t>/)![1]
    expect(text).toHaveLength(XLSX_MAX_CELL_CHARS)
  })

  it('writes only a header row for an empty export', () => {
    const xml = sheetXml([], { a: 'A' })
    expect(xml).toContain('<row r="1">')
    expect(xml).not.toContain('<row r="2">')
  })
})

describe('xlsxEntries', () => {
  it('contains every part Excel needs to open the workbook', () => {
    const entries = xlsxEntries([{ a: 1 }], undefined, 'Book[marks]?')
    expect(entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ])
    const workbook = new TextDecoder().decode(entries[2].data)
    // Sheet names may not contain []:*?/\
    expect(workbook).toContain('name="Book marks  "')
  })
})
