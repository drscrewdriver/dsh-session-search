#!/usr/bin/env node
/**
 * Smoke test: index the real local session stores and run a few searches.
 * Requires the plugin to be built (lib/) and real session files present.
 */
import { SessionSearchDb } from '../lib/db.js'
import { discoverFiles } from '../lib/discovery.js'
import { parseFile } from '../lib/parsers.js'
import { defaultRoots } from '../lib/discovery.js'

const roots = defaultRoots()
const enabled = new Set(['dsh', 'codex', 'claude', 'pi', 'opencode'])

const files = await discoverFiles(enabled, roots)
console.log(`discovered ${files.length} artifacts`)
for (const f of files.slice(0, 10)) console.log(`  ${f.source} ${f.path}`)

const db = new SessionSearchDb('/tmp/dsh-session-search-smoke.db', enabled)
const t0 = Date.now()
const indexed = await db.index(files)
console.log(`indexed ${indexed} sessions in ${Date.now() - t0}ms`)

for (const q of ['Minecraft', '多语言', 'TODO', 'session search']) {
  const t1 = Date.now()
  const hits = db.search({ query: q, limit: 3 })
  console.log(`\nquery "${q}": ${hits.length} hits (${Date.now() - t1}ms)`)
  for (const hit of hits.slice(0, 3)) {
    console.log(`  [${hit.session.source}] ${hit.session.title} (${hit.session.cwd})`)
    console.log(`    snippet: ${hit.snippet.slice(0, 120)}`)
  }
}

const sessions = db.listSessions(5)
console.log(`\nlatest sessions:`)
for (const s of sessions) console.log(`  [${s.source}] ${s.title} @ ${s.cwd}`)

db.close()
