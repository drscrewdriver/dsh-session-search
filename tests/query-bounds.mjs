#!/usr/bin/env node
/** SQL result bounds and caller-selected message-window regressions. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionSearchDb } from '../lib/db.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-session-search-bounds-'))
const dbPath = join(dir, 'index.db')
const db = new SessionSearchDb(dbPath, new Set(['dsh']), { maxMatchRows: 2 })
try {
  const seed = new DatabaseSync(dbPath)
  const insertSession = seed.prepare(`
    INSERT INTO sessions (source, session_id, path, title, cwd, created_at, updated_at, msg_count, mtime, size)
    VALUES ('dsh', ?, ?, ?, ?, 1, ?, 15, 3, 4)
  `)
  const insertMessage = seed.prepare(`
    INSERT INTO messages (source, session_id, seq, msg_id, role, content, ts)
    VALUES ('dsh', ?, ?, '', ?, ?, ?)
  `)
  const insertFts = seed.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)')
  for (let sessionIndex = 0; sessionIndex < 4; sessionIndex += 1) {
    const sessionId = `session-${sessionIndex}`
    insertSession.run(sessionId, `${sessionId}.jsonl`, sessionId, '/Ärea/work', 100 + sessionIndex)
    for (let seq = 0; seq < 15; seq += 1) {
      const content = `common phrase session ${sessionIndex} message ${seq}`
      const result = insertMessage.run(sessionId, seq, seq % 2 === 0 ? 'user' : 'assistant', content, seq)
      insertFts.run(result.lastInsertRowid, content)
    }
  }
  seed.close()

  const hits = db.search({ query: 'common phrase', cwd: 'ärea', limit: 10, window: 3 })
  if (hits.length !== 2) throw new Error(`SQL row cap expected 2 sessions, got ${hits.length}`)
  if (hits.some(hit => hit.window.length !== 3)) {
    throw new Error(`search window ignored requested size: ${JSON.stringify(hits.map(hit => hit.window.length))}`)
  }

  const one = db.readSession('dsh', 'session-0', 7, 1).messages.map(message => message.seq)
  const ten = db.readSession('dsh', 'session-0', 7, 10).messages.map(message => message.seq)
  if (one.length !== 1 || one[0] !== 7) throw new Error(`one-message window was not centered: ${JSON.stringify(one)}`)
  if (ten.length !== 10 || !ten.includes(7)) throw new Error(`ten-message window was not honored: ${JSON.stringify(ten)}`)

  console.log('query-bounds: all assertions passed')
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
