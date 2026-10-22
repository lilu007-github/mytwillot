import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep the SQLite index cache out of ~/.cache during tests.
process.env.TWILLOT_CACHE_DIR = mkdtempSync(join(tmpdir(), 'twillot-cache-'))
