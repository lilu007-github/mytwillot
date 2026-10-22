/**
 * Minimal, dependency-free .xlsx writer: a single worksheet of inline-string /
 * number / boolean cells, packaged with the STORE zip writer. No styles,
 * shared strings or formulas — just enough OOXML for Excel, Numbers and
 * LibreOffice to open it as a real spreadsheet (unlike CSV, no encoding or
 * delimiter guessing, and multi-line text stays in one cell).
 */
import { createZipBytes, ZipEntry } from './zip'

/** Excel's hard limit on characters in one cell. */
export const XLSX_MAX_CELL_CHARS = 32767

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/** Escape text for XML and drop characters XML 1.0 cannot represent. */
export function xmlText(value: string): string {
  return value
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '',
    )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cell(ref: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  }
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (text.length > XLSX_MAX_CELL_CHARS) {
    text = text.slice(0, XLSX_MAX_CELL_CHARS)
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`
}

/**
 * Worksheet XML. `columns` maps record keys to header labels (same shape as
 * the CSV exporter's translations); without it, the first row's keys are used.
 */
export function sheetXml(
  rows: Record<string, unknown>[],
  columns?: Record<string, string>,
): string {
  const keys = columns ? Object.keys(columns) : Object.keys(rows[0] || {})
  const header = columns ? Object.values(columns) : keys
  const lines = [header, ...rows.map((row) => keys.map((k) => row[k]))].map(
    (values, r) =>
      `<row r="${r + 1}">` +
      values.map((v, c) => cell(`${columnName(c)}${r + 1}`, v)).join('') +
      '</row>',
  )
  return (
    XML_DECL +
    `<worksheet xmlns="${NS_MAIN}"><sheetData>${lines.join('')}</sheetData></worksheet>`
  )
}

export function xlsxEntries(
  rows: Record<string, unknown>[],
  columns?: Record<string, string>,
  sheetName = 'Sheet1',
): ZipEntry[] {
  const enc = new TextEncoder()
  const files: Record<string, string> = {
    '[Content_Types].xml':
      XML_DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    '_rels/.rels':
      XML_DECL +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
    'xl/workbook.xml':
      XML_DECL +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
      // Sheet names: max 31 chars, none of []:*?/\
      `<sheet name="${xmlText(sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="1" r:id="rId1"/>` +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      XML_DECL +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      '</Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml(rows, columns),
  }
  return Object.entries(files).map(([name, xml]) => ({
    name,
    data: enc.encode(xml),
  }))
}

export function xlsxBytes(
  rows: Record<string, unknown>[],
  columns?: Record<string, string>,
  sheetName?: string,
): Uint8Array {
  return createZipBytes(xlsxEntries(rows, columns, sheetName))
}
