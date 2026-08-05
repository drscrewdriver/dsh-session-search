#!/usr/bin/env node
/**
 * Regression test: search queries must be treated as data, never as raw FTS5
 * syntax.
 *
 * The trigram tokenizer's query parser interprets `-` and `:` as column-filter
 * separators, `*` as a prefix operator, and a bare `"` as a syntax error.
 * Before the fix, `search({ query: 'test-Tieboyh' })` crashed with
 * `no such column: Tieboyh`, and `test*` silently expanded into a prefix
 * search. Every shape below must return literal substring hits instead.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionSearchDb } from '../lib/db.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-session-search-query-'))
const dbPath = join(dir, 'index.db')
const db = new SessionSearchDb(dbPath, new Set(['dsh']))
try {
  // Seed rows directly (the public `index()` API needs real artifact files).
  const seed = new DatabaseSync(dbPath)
  const sessionId = 'seed-session'
  seed.prepare(`
    INSERT INTO sessions (source, session_id, path, title, cwd, created_at, updated_at, msg_count, mtime, size)
    VALUES ('dsh', ?, 'seed.jsonl', 'seed', '/work', 1, 2, 7, 3, 4)
  `).run(sessionId)
  const rows = [
    ['hello test-Tieboyh world', 'assistant'],
    ['date 2026-08-03 stamp', 'user'],
    ['query time: now please', 'assistant'],
    ['one -two three', 'user'],
    ['say a"b loudly', 'assistant'],
    ['prefix testing only', 'user'],
    ['test Tieboyh with space', 'assistant'],
    ['Äx', 'user'],
  ]
  const insertMessage = seed.prepare(`
    INSERT INTO messages (source, session_id, seq, msg_id, role, content, ts)
    VALUES ('dsh', ?, ?, '', ?, ?, ?)
  `)
  const insertFts = seed.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)')
  rows.forEach(([content, role], i) => {
    const result = insertMessage.run(sessionId, i, role, content, i + 1)
    insertFts.run(result.lastInsertRowid, content)
  })
  seed.close()

  // `bestMatch` is the strongest matching message; windows contain neighbors.
  const bestContents = (query) => db.search({ query, limit: 10 }).map(hit => hit.bestMatch.content)

  // FTS path (>= 3 letter/number chars): dash, colon, CJK, star must not crash
  // or change meaning.
  const dashBest = bestContents('test-Tieboyh')
  if (dashBest.length !== 1 || dashBest[0] !== 'hello test-Tieboyh world') {
    throw new Error(`query "test-Tieboyh" expected the exact-dash message, got ${JSON.stringify(dashBest)}`)
  }
  const dateBest = bestContents('2026-08-03')
  if (dateBest.length !== 1 || dateBest[0] !== 'date 2026-08-03 stamp') {
    throw new Error(`query "2026-08-03" expected the date message, got ${JSON.stringify(dateBest)}`)
  }
  const colonBest = bestContents('time: now')
  if (colonBest.length !== 1 || colonBest[0] !== 'query time: now please') {
    throw new Error(`query "time: now" expected the colon message, got ${JSON.stringify(colonBest)}`)
  }
  const notBest = bestContents('one -two')
  if (notBest.length !== 1 || notBest[0] !== 'one -two three') {
    throw new Error(`query "one -two" expected the dash message, got ${JSON.stringify(notBest)}`)
  }
  bestContents('test*') // must not throw (a raw prefix query used to be accepted)
  bestContents('中文-测试') // CJK with dash must not throw

  // LIKE fallback path (< 3 letter/number chars) stays literal too.
  const quoteHits = db.search({ query: 'a"b', limit: 10 })
  const quoteBest = quoteHits.map(hit => hit.bestMatch.content)
  if (quoteBest.length !== 1 || quoteBest[0] !== 'say a"b loudly') {
    throw new Error(`query 'a"b' expected the quoted message, got ${JSON.stringify(quoteBest)}`)
  }
  // Short queries take the LIKE branch ('' AS snippet); the empty snippet
  // must fall back to clipped content instead of returning ''.
  if (quoteHits.length !== 1 || quoteHits[0].snippet.length === 0) {
    throw new Error(`short-query snippet must fall back to content, got ${JSON.stringify(quoteHits[0]?.snippet)}`)
  }
  const unicodeBest = bestContents('äx')
  if (unicodeBest.length !== 1 || unicodeBest[0] !== 'Äx') {
    throw new Error(`short Unicode query must use FTS-compatible case folding, got ${JSON.stringify(unicodeBest)}`)
  }

  console.log('query-safety: all assertions passed')
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
