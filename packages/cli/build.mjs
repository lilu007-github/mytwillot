// Bundle the CLI (and the shared utils types/format it imports) into one
// executable ESM file; npm dependencies stay external.
import { build } from 'esbuild'
import { chmodSync } from 'node:fs'

const outfile = 'dist/twillot.mjs'
await build({
  entryPoints: ['src/bin.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // utils is a workspace source package, not a built dependency: inline it.
  external: ['@modelcontextprotocol/sdk', 'zod'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
})
chmodSync(outfile, 0o755)
