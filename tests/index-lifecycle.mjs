#!/usr/bin/env node
/** Incremental cache, vanished-artifact cleanup, and cross-process atomicity regressions. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { SessionSearchDb } from '../lib/db.js'

if (process.argv[2] === 'worker') {
  const db = new SessionSearchDb(process.argv[3], new Set(['codex', 'opencode']))
  const files = JSON.parse(process.argv[4])
  await db.index(files)
  db.close()
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-session-search-index-'))
try {
  const files = []
  for (let index = 0; index < 20; index += 1) {
    const path = join(dir, `rollout-${index}.jsonl`)
    writeFileSync(path, [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { cwd: '/work' } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'user_message', message: `message ${index}` } }),
    ].join('\n'))
    files.push({ source: 'codex', path })
  }

  const dbPath = join(dir, 'index.db')
  const initial = new SessionSearchDb(dbPath, new Set(['codex', 'opencode']))
  const first = await initial.index(files)
  const second = await initial.index(files)
  if (first !== files.length || second !== 0) {
    throw new Error(`incremental counts expected ${files.length}/0, got ${first}/${second}`)
  }
  initial.close()

  for (const [index, file] of files.entries()) {
    writeFileSync(file.path, [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { cwd: '/work' } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'user_message', message: `message ${index}` } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:02Z', payload: { type: 'agent_message', message: `reply ${index}` } }),
    ].join('\n'))
  }
  await Promise.all([
    runWorker(dbPath, files),
    runWorker(dbPath, [...files].reverse()),
  ])
  assertIndexConsistent(dbPath, files.length, files.length * 2)

  const cleanup = new SessionSearchDb(dbPath, new Set(['codex', 'opencode']))
  await cleanup.index([])
  cleanup.close()
  assertIndexConsistent(dbPath, 0, 0)

  console.log('index-lifecycle: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

function runWorker(dbPath, files) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [import.meta.filename, 'worker', dbPath, JSON.stringify(files)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`index worker exited ${code}: ${stderr}`))
    })
  })
}

function assertIndexConsistent(path, expectedSessions, expectedMessages) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const sessions = db.prepare('SELECT count(*) AS n FROM sessions').get().n
    const messages = db.prepare('SELECT count(*) AS n FROM messages').get().n
    const fts = db.prepare('SELECT count(*) AS n FROM messages_fts').get().n
    const orphanFts = db.prepare(`
      SELECT count(*) AS n FROM messages_fts AS f
      LEFT JOIN messages AS m ON m.id = f.rowid
      WHERE m.id IS NULL
    `).get().n
    if (sessions !== expectedSessions || messages !== expectedMessages || fts !== expectedMessages || orphanFts !== 0) {
      throw new Error(`inconsistent index: ${JSON.stringify({ sessions, messages, fts, orphanFts, expectedSessions, expectedMessages })}`)
    }
  } finally {
    db.close()
  }
}
