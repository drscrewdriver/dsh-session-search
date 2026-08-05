/**
 * SQLite FTS5 (trigram) index and query layer for cross-agent session search.
 *
 * Mirrors the schema proven by pi's session-search extension: a `sessions`
 * table for metadata, a `messages` table for normalized messages, and an
 * FTS5 virtual table (trigram tokenizer) for substring search — including
 * CJK, which unicode61 cannot match. Indexing is incremental: artifacts whose
 * (mtime, size) are unchanged since the last pass are skipped.
 * @module @dsh-external/dsh-session-search/db
 */

import { openSync, closeSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import type {
  AgentMessageRecord,
  AgentSearchHit,
  AgentSessionRecord,
  AgentSource,
  ParsedSession,
} from './types.js'

/** Current derived-index schema version; incompatible versions reset in place. */
export const SESSION_SEARCH_SCHEMA_VERSION = 3

/**
 * What changed per schema version, so a bump can force a full reindex:
 * - v3: artifact state is tracked separately so unchanged files skip parsing;
 *   v2 rows are retained and populate the artifact table on their next pass.
 * - v2: dsh parsing decodes every concatenated zstd frame (v1 indexed dsh
 *   sessions with zero messages); v1 data is cleared so the next pass repairs
 *   it.
 */

/** Owner-only creation of a missing database file. */
function createDatabaseFile(path: string): void {
  try {
    const fd = openSync(path, 'wx', 0o600)
    closeSync(fd)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** One search request against the index. */
export interface SearchRequest {
  /** Full-text query, interpreted as data (never raw FTS syntax). */
  query: string
  /** Source families to restrict to; empty means all indexed sources. */
  sources?: readonly AgentSource[]
  /** Role filter; empty means user + assistant. */
  roles?: readonly AgentMessageRecord['role'][]
  /** Working-directory substring filter. */
  cwd?: string
  /** Maximum sessions returned. */
  limit: number
  /** Ordering of the result sessions. */
  sort?: 'relevance' | 'newest' | 'oldest'
  /** Number of messages returned around each best match. */
  window?: number
}

/** One search hit: session, strongest message, snippet, and window. */
export interface SearchHit extends AgentSearchHit {
  /** Messages surrounding the best match, in seq order. */
  window: AgentMessageRecord[]
}

interface ArtifactPlan {
  source: AgentSource
  path: string
  mtime: number
  size: number
  sessions: ParsedSession[]
}

/** Database-owned resource bounds. */
export interface SessionSearchDbOptions {
  /** Maximum session-ranked rows materialized by one search. */
  maxMatchRows?: number
}

/** Count searchable (letter/number) characters; trigram needs >= 3. */
function searchableChars(q: string): number {
  let n = 0
  for (const ch of q) {
    if (/[\p{L}\p{N}]/u.test(ch)) n++
  }
  return n
}

/**
 * Quote caller text as one FTS5 phrase so query syntax stays inert data.
 *
 * The trigram tokenizer's query parser treats `-` and `:` as column-filter
 * separators (`a-b` fails with `no such column: b`) and `*` as a prefix
 * operator; a bare `"` even fails to parse. Wrapping the query in double
 * quotes (doubling embedded quotes, as FTS5 phrase syntax requires) makes the
 * whole text one literal phrase: substring semantics identical to the LIKE
 * fallback, with no syntax interpreted.
 * @param query - normalized caller query.
 * @returns FTS5 expression containing one escaped literal phrase.
 */
function quoteFtsQuery(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

/** FTS5 snippet length in tokens. */
const SNIPPET_LEN = 18
/** Default maximum number of session-ranked rows materialized by one search. */
export const DEFAULT_MAX_MATCH_ROWS = 1000
/** Default messages returned around a hit. */
const DEFAULT_WINDOW = 10
/** Per-message truncation when returning to the model. */
const MSG_RETURN_CHARS = 350

function clip(content: string): string {
  return content.length > MSG_RETURN_CHARS ? `${content.slice(0, MSG_RETURN_CHARS)}…` : content
}

/** Incremental index over discovered session artifacts. */
export class SessionSearchDb {
  private readonly db: DatabaseSync
  private readonly maxMatchRows: number
  /** Serialized indexing pass; only one runs at a time. */
  private indexing: Promise<number> | null = null

  constructor(
    path: string,
    private readonly enabled: ReadonlySet<AgentSource>,
    options: SessionSearchDbOptions = {},
  ) {
    const maxMatchRows = options.maxMatchRows ?? DEFAULT_MAX_MATCH_ROWS
    if (!Number.isSafeInteger(maxMatchRows) || maxMatchRows < 1) {
      throw new TypeError('session-search maxMatchRows must be a positive safe integer')
    }
    this.maxMatchRows = maxMatchRows
    const actual = resolve(path)
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
    createDatabaseFile(actual)
    this.db = new DatabaseSync(actual)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.function('unicode_contains', { deterministic: true }, (value: unknown, needle: unknown) => {
      if (typeof value !== 'string' || typeof needle !== 'string') return 0
      return value.toLowerCase().includes(needle.toLowerCase()) ? 1 : 0
    })
    this.ensureSchema()
  }

  /** Create or migrate the derived index without dropping tables used by older live readers. */
  private ensureSchema(): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version > SESSION_SEARCH_SCHEMA_VERSION) {
      throw new Error(`session-search index schema ${version} is newer than supported version ${SESSION_SEARCH_SCHEMA_VERSION}`)
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          source       TEXT NOT NULL,
          session_id   TEXT NOT NULL,
          path         TEXT NOT NULL,
          title        TEXT NOT NULL DEFAULT '',
          cwd          TEXT NOT NULL DEFAULT '',
          created_at   INTEGER NOT NULL DEFAULT 0,
          updated_at   INTEGER NOT NULL DEFAULT 0,
          msg_count    INTEGER NOT NULL DEFAULT 0,
          mtime        INTEGER NOT NULL DEFAULT 0,
          size         INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (source, session_id)
        ) STRICT
      `)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          source     TEXT NOT NULL,
          session_id TEXT NOT NULL,
          seq        INTEGER NOT NULL,
          msg_id     TEXT NOT NULL DEFAULT '',
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          ts         INTEGER NOT NULL DEFAULT 0,
          UNIQUE (source, session_id, seq)
        ) STRICT
      `)
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          tokenize = 'trigram'
        )
      `)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          source TEXT NOT NULL,
          path   TEXT NOT NULL,
          mtime  INTEGER NOT NULL,
          size   INTEGER NOT NULL,
          PRIMARY KEY (source, path)
        ) STRICT
      `)
      if (version > 0 && version < 2) {
        this.db.exec('DELETE FROM messages_fts')
        this.db.exec('DELETE FROM messages')
        this.db.exec('DELETE FROM sessions')
        this.db.exec('DELETE FROM artifacts')
      }
      this.db.exec(`PRAGMA user_version = ${SESSION_SEARCH_SCHEMA_VERSION}`)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Serialize one indexing pass over the given artifact list. */
  async index(artifacts: Array<{ source: AgentSource; path: string }>): Promise<number> {
    if (this.indexing !== null) return this.indexing
    this.indexing = this.runIndex(artifacts)
    try {
      return await this.indexing
    } finally {
      this.indexing = null
    }
  }

  /** The single indexing pass: upsert changed artifacts, drop vanished ones. */
  private async runIndex(artifacts: Array<{ source: AgentSource; path: string }>): Promise<number> {
    const { parseFile } = await import('./parsers.js')
    const discovered = new Set<string>()
    const plans: ArtifactPlan[] = []
    const artifactState = this.db.prepare('SELECT mtime, size FROM artifacts WHERE source = ? AND path = ?')

    for (const artifact of artifacts) {
      if (!this.enabled.has(artifact.source)) continue
      const artifactKey = this.key(artifact.source, artifact.path)
      if (discovered.has(artifactKey)) continue
      discovered.add(artifactKey)
      const before = await stat(artifact.path).catch(() => null)
      if (before === null) continue
      const size = before.size
      const mtime = Math.round(before.mtimeMs)
      const state = artifactState.get(artifact.source, artifact.path) as { mtime: number; size: number } | undefined
      if (state?.mtime === mtime && state.size === size) continue

      const parsedList = await parseFile(artifact.source, artifact.path)
      if (parsedList === undefined) continue
      const after = await stat(artifact.path).catch(() => null)
      if (after === null || after.size !== size || Math.round(after.mtimeMs) !== mtime) continue
      plans.push({ source: artifact.source, path: artifact.path, mtime, size, sessions: parsedList })
    }

    let indexed = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const plan of plans) {
        const state = artifactState.get(plan.source, plan.path) as { mtime: number; size: number } | undefined
        if (state?.mtime === plan.mtime && state.size === plan.size) continue
        this.replaceArtifact(plan)
        indexed += plan.sessions.length
      }

      const known = this.db.prepare(`
        SELECT source, path FROM artifacts
        UNION
        SELECT source, path FROM sessions
      `).all() as Array<{ source: string; path: string }>
      for (const row of known) {
        const source = row.source as AgentSource
        if (this.enabled.has(source) && !discovered.has(this.key(source, row.path))) {
          this.dropArtifact(source, row.path)
          this.db.prepare('DELETE FROM artifacts WHERE source = ? AND path = ?').run(source, row.path)
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return indexed
  }

  /** Atomically replace every indexed session owned by one artifact. */
  private replaceArtifact(plan: ArtifactPlan): void {
    this.dropArtifact(plan.source, plan.path)
    const insertSession = this.db.prepare(`
      INSERT INTO sessions
        (source, session_id, path, title, cwd, created_at, updated_at, msg_count, mtime, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMessage = this.db.prepare(`
      INSERT INTO messages (source, session_id, seq, msg_id, role, content, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const insertFts = this.db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)')
    for (const parsed of plan.sessions) {
      const session = parsed.session
      this.dropSession(session.source, session.sessionId)
      for (const message of parsed.messages) {
        const result = insertMessage.run(
          message.source,
          message.sessionId,
          message.seq,
          message.msgId,
          message.role,
          message.content,
          message.ts,
        )
        insertFts.run(result.lastInsertRowid, message.content)
      }
      insertSession.run(
        session.source,
        session.sessionId,
        session.path,
        session.title,
        session.cwd,
        session.createdAt,
        session.updatedAt,
        parsed.messages.length,
        plan.mtime,
        plan.size,
      )
    }
    this.db.prepare(`
      INSERT INTO artifacts (source, path, mtime, size) VALUES (?, ?, ?, ?)
      ON CONFLICT (source, path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size
    `).run(plan.source, plan.path, plan.mtime, plan.size)
  }

  /** Remove every session and message owned by one artifact. */
  private dropArtifact(source: AgentSource, path: string): void {
    const rows = this.db.prepare(
      'SELECT session_id FROM sessions WHERE source = ? AND path = ?',
    ).all(source, path) as Array<{ session_id: string }>
    for (const row of rows) this.dropSession(source, row.session_id)
  }

  /** Remove one session and its mirrored FTS rows. */
  private dropSession(source: AgentSource, sessionId: string): void {
    const ids = this.db.prepare(
      'SELECT id FROM messages WHERE source = ? AND session_id = ?',
    ).all(source, sessionId) as Array<{ id: number }>
    for (const { id } of ids) {
      this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(id)
    }
    this.db.prepare('DELETE FROM messages WHERE source = ? AND session_id = ?').run(source, sessionId)
    this.db.prepare('DELETE FROM sessions WHERE source = ? AND session_id = ?').run(source, sessionId)
  }

  private key(source: AgentSource, sessionId: string): string {
    return `${source}\u0000${sessionId}`
  }

  /**
   * Run a full-text search and return session-grouped hits.
   * @param request - normalized search request.
   * @returns hits with message windows, in requested order.
   */
  search(request: SearchRequest): SearchHit[] {
    const query = request.query.trim()
    if (query.length === 0) return []
    const roles = request.roles !== undefined && request.roles.length > 0
      ? request.roles
      : ['user', 'assistant']
    const sources = request.sources ?? []
    const roleSql = roles.map(() => '?').join(',')
    const sourceSql = sources.length > 0 ? sources.map(() => '?').join(',') : ''
    const cwdSql = request.cwd !== undefined && request.cwd.length > 0 ? 'AND unicode_contains(s.cwd, ?) = 1' : ''
    const cwdParams = cwdSql.length > 0 ? [request.cwd as string] : []
    const orderSql = request.sort === 'newest'
      ? 'updated_at DESC, score ASC, ts DESC'
      : request.sort === 'oldest'
        ? 'updated_at ASC, score ASC, ts DESC'
        : 'score ASC, ts DESC'
    const fts = searchableChars(query) >= 3

    const rows = fts
      ? this.db.prepare(`
          WITH matched AS (
            SELECT m.id, m.source, m.session_id, m.seq, m.msg_id, m.role, m.content, m.ts,
                   s.path, s.title, s.cwd, s.created_at, s.updated_at, s.msg_count, s.mtime, s.size,
                   bm25(messages_fts) AS score
            FROM messages_fts
            JOIN messages m ON m.id = messages_fts.rowid
            JOIN sessions s ON s.source = m.source AND s.session_id = m.session_id
            WHERE messages_fts MATCH ? AND m.role IN (${roleSql})
              ${sourceSql.length > 0 ? `AND m.source IN (${sourceSql})` : ''}
              ${cwdSql}
          ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (
              PARTITION BY source, session_id ORDER BY score ASC, ts DESC, seq DESC
            ) AS event_rank
            FROM matched
          )
          SELECT *, '' AS snippet FROM ranked
          WHERE event_rank = 1
          ORDER BY ${orderSql}
          LIMIT ?
        `).all(quoteFtsQuery(query), ...roles, ...sources, ...cwdParams, this.maxMatchRows)
      : this.db.prepare(`
          WITH matched AS (
            SELECT m.id, m.source, m.session_id, m.seq, m.msg_id, m.role, m.content, m.ts,
                   s.path, s.title, s.cwd, s.created_at, s.updated_at, s.msg_count, s.mtime, s.size,
                   0 AS score
            FROM messages m
            JOIN sessions s ON s.source = m.source AND s.session_id = m.session_id
            WHERE unicode_contains(m.content, ?) = 1 AND m.role IN (${roleSql})
              ${sourceSql.length > 0 ? `AND m.source IN (${sourceSql})` : ''}
              ${cwdSql}
          ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (
              PARTITION BY source, session_id ORDER BY ts DESC, seq DESC
            ) AS event_rank
            FROM matched
          )
          SELECT *, '' AS snippet FROM ranked
          WHERE event_rank = 1
          ORDER BY ${orderSql}
          LIMIT ?
        `).all(query, ...roles, ...sources, ...cwdParams, this.maxMatchRows)

    if (fts) {
      const snippet = this.db.prepare(`
        SELECT snippet(messages_fts, 0, '[', ']', '…', ${SNIPPET_LEN}) AS text
        FROM messages_fts WHERE rowid = ? AND messages_fts MATCH ?
      `)
      for (const row of rows as Array<Record<string, unknown>>) {
        row.snippet = (snippet.get(row.id as number, quoteFtsQuery(query)) as { text: string }).text
      }
    }

    const grouped: SearchHit[] = []
    for (const row of rows as Array<Record<string, unknown>>) {
      const hit = this.hitFromRow(row)
      grouped.push({
        ...hit,
        window: this.windowAround(hit.session, hit.bestMatch.seq, request.window ?? DEFAULT_WINDOW),
      })
    }
    return grouped.slice(0, request.limit)
  }

  /** Build one hit from a query row. */
  private hitFromRow(row: Record<string, unknown>): Omit<AgentSearchHit, 'window'> {
    const session: AgentSessionRecord = {
      source: row.source as AgentSource,
      sessionId: row.session_id as string,
      path: row.path as string,
      title: row.title as string,
      cwd: row.cwd as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      messageCount: row.msg_count as number,
      size: row.size as number,
      mtime: row.mtime as number,
    }
    const bestMatch: AgentMessageRecord = {
      source: row.source as AgentSource,
      sessionId: row.session_id as string,
      seq: row.seq as number,
      msgId: row.msg_id as string,
      role: row.role as AgentMessageRecord['role'],
      content: row.content as string,
      ts: row.ts as number,
    }
    return {
      session,
      bestMatch,
      // The LIKE branch selects '' AS snippet; only a real empty string must
      // fall back to the clipped content.
      snippet: typeof row.snippet === 'string' && row.snippet.length > 0 ? row.snippet : clip(bestMatch.content),
    }
  }

  /** Messages of one session in seq order. */
  sessionMessages(source: AgentSource, sessionId: string): AgentMessageRecord[] {
    const rows = this.db.prepare(
      'SELECT source, session_id, seq, msg_id, role, content, ts FROM messages WHERE source = ? AND session_id = ? ORDER BY seq',
    ).all(source, sessionId) as Array<{
      source: string
      session_id: string
      seq: number
      msg_id: string
      role: string
      content: string
      ts: number
    }>
    return rows.map(row => ({
      source: row.source as AgentSource,
      sessionId: row.session_id,
      seq: row.seq,
      msgId: row.msg_id,
      role: row.role as AgentMessageRecord['role'],
      content: row.content,
      ts: row.ts,
    }))
  }

  /** Messages around a message seq within a session. */
  private windowAround(session: AgentSessionRecord, seq: number, window: number): AgentMessageRecord[] {
    const messages = this.sessionMessages(session.source, session.sessionId)
    const index = messages.findIndex(m => m.seq === seq)
    if (index < 0) return []
    return centeredWindow(messages, index, window)
  }

  /** Read one session's metadata and a message window. */
  readSession(
    source: AgentSource,
    sessionId: string,
    aroundSeq?: number,
    window = 10,
  ): { session: AgentSessionRecord | undefined; messages: AgentMessageRecord[] } {
    const sessionRow = this.db.prepare(
      'SELECT * FROM sessions WHERE source = ? AND session_id = ?',
    ).get(source, sessionId) as Record<string, unknown> | undefined
    const messages = this.sessionMessages(source, sessionId)
    if (sessionRow === undefined) return { session: undefined, messages }
    const session: AgentSessionRecord = {
      source: sessionRow.source as AgentSource,
      sessionId: sessionRow.session_id as string,
      path: sessionRow.path as string,
      title: sessionRow.title as string,
      cwd: sessionRow.cwd as string,
      createdAt: sessionRow.created_at as number,
      updatedAt: sessionRow.updated_at as number,
      messageCount: sessionRow.msg_count as number,
      size: sessionRow.size as number,
      mtime: sessionRow.mtime as number,
    }
    if (aroundSeq === undefined) return { session, messages: messages.slice(-window) }
    const index = messages.findIndex(m => m.seq === aroundSeq)
    if (index < 0) return { session, messages: messages.slice(-window) }
    return { session, messages: centeredWindow(messages, index, window) }
  }

  /** List sessions in the index, newest first. */
  listSessions(limit = 100): AgentSessionRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?',
    ).all(limit) as Array<Record<string, unknown>>
    return rows.map(row => ({
      source: row.source as AgentSource,
      sessionId: row.session_id as string,
      path: row.path as string,
      title: row.title as string,
      cwd: row.cwd as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      messageCount: row.msg_count as number,
      size: row.size as number,
      mtime: row.mtime as number,
    }))
  }

  /** Close the database handle. */
  close(): void {
    this.db.close()
  }
}

function centeredWindow<T>(values: readonly T[], index: number, requested: number): T[] {
  const size = Number.isSafeInteger(requested) && requested > 0 ? requested : DEFAULT_WINDOW
  const before = Math.floor((size - 1) / 2)
  let start = Math.max(0, index - before)
  const end = Math.min(values.length, start + size)
  start = Math.max(0, end - size)
  return values.slice(start, end)
}
