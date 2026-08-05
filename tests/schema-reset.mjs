#!/usr/bin/env node
/**
 * Regression test: schema-version bumps must reset the derived index in
 * place. Without the reset, incremental indexing skips unchanged artifacts by
 * (mtime, size) and parse fixes (e.g. multi-frame dsh decoding) never reach
 * already-indexed sessions.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionSearchDb, SESSION_SEARCH_SCHEMA_VERSION } from '../lib/db.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-session-search-schema-'))
const dbPath = join(dir, 'index.db')
try {
  // Build a current-version index and stash a stale version marker on it.
  const db = new SessionSearchDb(dbPath, new Set(['dsh']))
  db.search({ query: 'x', limit: 1 }) // exercises the opened handle
  const raw = new DatabaseSync(dbPath)
  raw.prepare(`
    INSERT INTO sessions (source, session_id, path, title, cwd, created_at, updated_at, msg_count, mtime, size)
    VALUES ('dsh', 'stale', 'x.jsonl', 'stale', '/work', 1, 2, 1, 3, 4)
  `).run()
  raw.exec(`PRAGMA user_version = ${SESSION_SEARCH_SCHEMA_VERSION - 1}`)
  raw.close()
  db.close()

  // Reopening a stale-version index must wipe and recreate the tables.
  const reopened = new SessionSearchDb(dbPath, new Set(['dsh']))
  const rows = rawCount(dbPath, 'sessions')
  const version = rawVersion(dbPath)
  if (rows !== 0) throw new Error(`stale index not reset: ${rows} session rows remain`)
  if (version !== SESSION_SEARCH_SCHEMA_VERSION) {
    throw new Error(`user_version expected ${SESSION_SEARCH_SCHEMA_VERSION}, got ${version}`)
  }
  // The recreated index is usable.
  reopened.search({ query: 'x', limit: 1 })
  reopened.close()

  console.log('schema-reset: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

function rawCount(path, table) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n
  } finally {
    db.close()
  }
}

function rawVersion(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('PRAGMA user_version').get().user_version
  } finally {
    db.close()
  }
}
