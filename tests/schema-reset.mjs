#!/usr/bin/env node
/** Regression coverage for data reset and non-destructive schema upgrades. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionSearchDb, SESSION_SEARCH_SCHEMA_VERSION } from '../lib/db.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-session-search-schema-'))
try {
  const stalePath = join(dir, 'stale-v1.db')
  seedCurrentIndex(stalePath)
  const stale = new DatabaseSync(stalePath)
  stale.exec('PRAGMA user_version = 1')
  stale.close()
  const reset = new SessionSearchDb(stalePath, new Set(['dsh']))
  if (rowCount(stalePath, 'sessions') !== 0) throw new Error('v1 derived rows were not reset')
  reset.close()

  const upgradePath = join(dir, 'upgrade-v2.db')
  seedCurrentIndex(upgradePath)
  const oldReader = new DatabaseSync(upgradePath)
  oldReader.exec('DROP TABLE artifacts')
  oldReader.exec('PRAGMA user_version = 2')
  const upgraded = new SessionSearchDb(upgradePath, new Set(['dsh']))
  if (rowCount(upgradePath, 'sessions') !== 1) throw new Error('v2 rows were destroyed during migration')
  if (oldReader.prepare('SELECT count(*) AS n FROM sessions').get().n !== 1) {
    throw new Error('pre-upgrade reader lost access to retained tables')
  }
  if (schemaVersion(upgradePath) !== SESSION_SEARCH_SCHEMA_VERSION) {
    throw new Error(`schema version did not advance to ${SESSION_SEARCH_SCHEMA_VERSION}`)
  }
  oldReader.close()
  upgraded.close()

  console.log('schema-reset: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

function seedCurrentIndex(path) {
  const index = new SessionSearchDb(path, new Set(['dsh']))
  index.close()
  const db = new DatabaseSync(path)
  db.prepare(`
    INSERT INTO sessions (source, session_id, path, title, cwd, created_at, updated_at, msg_count, mtime, size)
    VALUES ('dsh', 'seed', 'seed.jsonl', 'seed', '/work', 1, 2, 0, 3, 4)
  `).run()
  db.close()
}

function rowCount(path, table) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n
  } finally {
    db.close()
  }
}

function schemaVersion(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('PRAGMA user_version').get().user_version
  } finally {
    db.close()
  }
}
