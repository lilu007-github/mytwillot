/**
 * Minimal, dependency-free ZIP writer (STORE method, no compression). Produces
 * a valid .zip Blob from a list of {name, data} entries. Names may contain "/"
 * to create nested folders. UTF-8 filenames (general-purpose flag bit 11).
 *
 * We store (not deflate) to stay tiny and dependency-free — Markdown notes
 * compress little and the user unzips once into their vault.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function createZip(entries: ZipEntry[]): Blob {
  return new Blob([createZipBytes(entries)], { type: 'application/zip' })
}

/** Assemble the raw ZIP bytes (testable without a Blob polyfill). */
export function createZipBytes(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const header = new Uint8Array(30 + nameBytes.length)
    const hv = new DataView(header.buffer)
    hv.setUint32(0, 0x04034b50, true) // local file header signature
    hv.setUint16(4, 20, true) // version needed
    hv.setUint16(6, 0x0800, true) // flags: UTF-8 filename
    hv.setUint16(8, 0, true) // method: store
    hv.setUint16(10, 0, true) // mod time
    hv.setUint16(12, 0, true) // mod date
    hv.setUint32(14, crc, true)
    hv.setUint32(18, size, true) // compressed size
    hv.setUint32(22, size, true) // uncompressed size
    hv.setUint16(26, nameBytes.length, true)
    hv.setUint16(28, 0, true) // extra length
    header.set(nameBytes, 30)
    local.push(header, entry.data)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true) // central dir signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true) // flags: UTF-8
    cv.setUint16(10, 0, true) // method
    cv.setUint16(12, 0, true) // mod time
    cv.setUint16(14, 0, true) // mod date
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra length
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk number
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    cd.set(nameBytes, 46)
    central.push(cd)

    offset += header.length + size
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // EOCD signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // disk with central dir
  ev.setUint16(8, entries.length, true) // entries on this disk
  ev.setUint16(10, entries.length, true) // total entries
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true) // central dir offset
  ev.setUint16(20, 0, true) // comment length

  const parts = [...local, ...central, eocd]
  const totalLen = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}
