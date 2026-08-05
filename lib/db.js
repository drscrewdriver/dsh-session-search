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
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
/** Current derived-index schema version; incompatible versions reset in place. */
export const SESSION_SEARCH_SCHEMA_VERSION = 3;
/**
 * What changed per schema version, so a bump can force a full reindex:
 * - v3: artifact state is tracked separately so unchanged files skip parsing;
 *   v2 rows are retained and populate the artifact table on their next pass.
 * - v2: dsh parsing decodes every concatenated zstd frame (v1 indexed dsh
 *   sessions with zero messages); v1 data is cleared so the next pass repairs
 *   it.
 */
/** Owner-only creation of a missing database file. */
function createDatabaseFile(path) {
    try {
        const fd = openSync(path, 'wx', 0o600);
        closeSync(fd);
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
}
/** Count searchable (letter/number) characters; trigram needs >= 3. */
function searchableChars(q) {
    let n = 0;
    for (const ch of q) {
        if (/[\p{L}\p{N}]/u.test(ch))
            n++;
    }
    return n;
}
/** Escape LIKE wildcards so user input matches literally. */
function escapeLike(s) {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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
function quoteFtsQuery(query) {
    return `"${query.replaceAll('"', '""')}"`;
}
/** FTS5 snippet length in tokens. */
const SNIPPET_LEN = 18;
/** Messages returned around a hit. */
const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 4;
/** Per-message truncation when returning to the model. */
const MSG_RETURN_CHARS = 350;
function clip(content) {
    return content.length > MSG_RETURN_CHARS ? `${content.slice(0, MSG_RETURN_CHARS)}…` : content;
}
/** Incremental index over discovered session artifacts. */
export class SessionSearchDb {
    enabled;
    db;
    /** Serialized indexing pass; only one runs at a time. */
    indexing = null;
    constructor(path, enabled) {
        this.enabled = enabled;
        const actual = resolve(path);
        mkdirSync(dirname(actual), { recursive: true, mode: 0o700 });
        createDatabaseFile(actual);
        this.db = new DatabaseSync(actual);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA synchronous = NORMAL');
        this.db.exec('PRAGMA busy_timeout = 5000');
        this.ensureSchema();
    }
    /** Create or migrate the derived index without dropping tables used by older live readers. */
    ensureSchema() {
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        if (version > SESSION_SEARCH_SCHEMA_VERSION) {
            throw new Error(`session-search index schema ${version} is newer than supported version ${SESSION_SEARCH_SCHEMA_VERSION}`);
        }
        this.db.exec('BEGIN IMMEDIATE');
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
      `);
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
      `);
            this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          tokenize = 'trigram'
        )
      `);
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          source TEXT NOT NULL,
          path   TEXT NOT NULL,
          mtime  INTEGER NOT NULL,
          size   INTEGER NOT NULL,
          PRIMARY KEY (source, path)
        ) STRICT
      `);
            if (version > 0 && version < 2) {
                this.db.exec('DELETE FROM messages_fts');
                this.db.exec('DELETE FROM messages');
                this.db.exec('DELETE FROM sessions');
                this.db.exec('DELETE FROM artifacts');
            }
            this.db.exec(`PRAGMA user_version = ${SESSION_SEARCH_SCHEMA_VERSION}`);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    /** Serialize one indexing pass over the given artifact list. */
    async index(artifacts) {
        if (this.indexing !== null)
            return this.indexing;
        this.indexing = this.runIndex(artifacts);
        try {
            return await this.indexing;
        }
        finally {
            this.indexing = null;
        }
    }
    /** The single indexing pass: upsert changed artifacts, drop vanished ones. */
    async runIndex(artifacts) {
        const { parseFile } = await import('./parsers.js');
        const discovered = new Set();
        const plans = [];
        const artifactState = this.db.prepare('SELECT mtime, size FROM artifacts WHERE source = ? AND path = ?');
        for (const artifact of artifacts) {
            if (!this.enabled.has(artifact.source))
                continue;
            const artifactKey = this.key(artifact.source, artifact.path);
            if (discovered.has(artifactKey))
                continue;
            discovered.add(artifactKey);
            const before = await stat(artifact.path).catch(() => null);
            if (before === null)
                continue;
            const size = before.size;
            const mtime = Math.round(before.mtimeMs);
            const state = artifactState.get(artifact.source, artifact.path);
            if (state?.mtime === mtime && state.size === size)
                continue;
            const parsedList = await parseFile(artifact.source, artifact.path);
            if (parsedList === undefined)
                continue;
            const after = await stat(artifact.path).catch(() => null);
            if (after === null || after.size !== size || Math.round(after.mtimeMs) !== mtime)
                continue;
            plans.push({ source: artifact.source, path: artifact.path, mtime, size, sessions: parsedList });
        }
        let indexed = 0;
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const plan of plans) {
                const state = artifactState.get(plan.source, plan.path);
                if (state?.mtime === plan.mtime && state.size === plan.size)
                    continue;
                this.replaceArtifact(plan);
                indexed += plan.sessions.length;
            }
            const known = this.db.prepare(`
        SELECT source, path FROM artifacts
        UNION
        SELECT source, path FROM sessions
      `).all();
            for (const row of known) {
                const source = row.source;
                if (this.enabled.has(source) && !discovered.has(this.key(source, row.path))) {
                    this.dropArtifact(source, row.path);
                    this.db.prepare('DELETE FROM artifacts WHERE source = ? AND path = ?').run(source, row.path);
                }
            }
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return indexed;
    }
    /** Atomically replace every indexed session owned by one artifact. */
    replaceArtifact(plan) {
        this.dropArtifact(plan.source, plan.path);
        const insertSession = this.db.prepare(`
      INSERT INTO sessions
        (source, session_id, path, title, cwd, created_at, updated_at, msg_count, mtime, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const insertMessage = this.db.prepare(`
      INSERT INTO messages (source, session_id, seq, msg_id, role, content, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const insertFts = this.db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)');
        for (const parsed of plan.sessions) {
            const session = parsed.session;
            this.dropSession(session.source, session.sessionId);
            for (const message of parsed.messages) {
                const result = insertMessage.run(message.source, message.sessionId, message.seq, message.msgId, message.role, message.content, message.ts);
                insertFts.run(result.lastInsertRowid, message.content);
            }
            insertSession.run(session.source, session.sessionId, session.path, session.title, session.cwd, session.createdAt, session.updatedAt, parsed.messages.length, plan.mtime, plan.size);
        }
        this.db.prepare(`
      INSERT INTO artifacts (source, path, mtime, size) VALUES (?, ?, ?, ?)
      ON CONFLICT (source, path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size
    `).run(plan.source, plan.path, plan.mtime, plan.size);
    }
    /** Remove every session and message owned by one artifact. */
    dropArtifact(source, path) {
        const rows = this.db.prepare('SELECT session_id FROM sessions WHERE source = ? AND path = ?').all(source, path);
        for (const row of rows)
            this.dropSession(source, row.session_id);
    }
    /** Remove one session and its mirrored FTS rows. */
    dropSession(source, sessionId) {
        const ids = this.db.prepare('SELECT id FROM messages WHERE source = ? AND session_id = ?').all(source, sessionId);
        for (const { id } of ids) {
            this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(id);
        }
        this.db.prepare('DELETE FROM messages WHERE source = ? AND session_id = ?').run(source, sessionId);
        this.db.prepare('DELETE FROM sessions WHERE source = ? AND session_id = ?').run(source, sessionId);
    }
    key(source, sessionId) {
        return `${source}\u0000${sessionId}`;
    }
    /**
     * Run a full-text search and return session-grouped hits.
     * @param request - normalized search request.
     * @returns hits with message windows, in requested order.
     */
    search(request) {
        const query = request.query.trim();
        if (query.length === 0)
            return [];
        const roles = request.roles !== undefined && request.roles.length > 0
            ? request.roles
            : ['user', 'assistant'];
        const sources = request.sources ?? [];
        const roleSql = roles.map(() => '?').join(',');
        const sourceSql = sources.length > 0 ? sources.map(() => '?').join(',') : '';
        const like = `%${escapeLike(query)}%`;
        const rows = searchableChars(query) >= 3
            ? this.db.prepare(`
          SELECT m.id, m.source, m.session_id, m.seq, m.msg_id, m.role, m.content, m.ts,
                 s.path, s.title, s.cwd, s.created_at, s.updated_at, s.msg_count, s.mtime, s.size,
                 snippet(messages_fts, 0, '[', ']', '…', ${SNIPPET_LEN}) AS snippet
          FROM messages_fts
          JOIN messages m ON m.id = messages_fts.rowid
          JOIN sessions s ON s.source = m.source AND s.session_id = m.session_id
          WHERE messages_fts MATCH ? AND m.role IN (${roleSql})
            ${sourceSql.length > 0 ? `AND m.source IN (${sourceSql})` : ''}
          ORDER BY bm25(messages_fts), m.ts DESC
        `).all(quoteFtsQuery(query), ...roles, ...sources)
            : this.db.prepare(`
          SELECT m.id, m.source, m.session_id, m.seq, m.msg_id, m.role, m.content, m.ts,
                 s.path, s.title, s.cwd, s.created_at, s.updated_at, s.msg_count, s.mtime, s.size,
                 '' AS snippet
          FROM messages m
          JOIN sessions s ON s.source = m.source AND s.session_id = m.session_id
          WHERE m.content LIKE ? ESCAPE '\\' AND m.role IN (${roleSql})
            ${sourceSql.length > 0 ? `AND m.source IN (${sourceSql})` : ''}
          ORDER BY m.ts DESC
        `).all(like, ...roles, ...sources);
        const bySession = new Map();
        for (const row of rows) {
            const hit = this.hitFromRow(row);
            const key = this.key(hit.session.source, hit.session.sessionId);
            if (!bySession.has(key)) {
                bySession.set(key, { ...hit, window: this.windowAround(hit.session, hit.bestMatch.seq) });
            }
        }
        let grouped = [...bySession.values()];
        if (request.sort === 'newest') {
            grouped.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
        }
        else if (request.sort === 'oldest') {
            grouped.sort((a, b) => a.session.updatedAt - b.session.updatedAt);
        }
        if (request.cwd !== undefined && request.cwd.length > 0) {
            const needle = request.cwd.toLowerCase();
            grouped = grouped.filter(hit => hit.session.cwd.toLowerCase().includes(needle));
        }
        return grouped.slice(0, request.limit);
    }
    /** Build one hit from a query row. */
    hitFromRow(row) {
        const session = {
            source: row.source,
            sessionId: row.session_id,
            path: row.path,
            title: row.title,
            cwd: row.cwd,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.msg_count,
            size: row.size,
            mtime: row.mtime,
        };
        const bestMatch = {
            source: row.source,
            sessionId: row.session_id,
            seq: row.seq,
            msgId: row.msg_id,
            role: row.role,
            content: row.content,
            ts: row.ts,
        };
        return {
            session,
            bestMatch,
            // The LIKE branch selects '' AS snippet; only a real empty string must
            // fall back to the clipped content.
            snippet: typeof row.snippet === 'string' && row.snippet.length > 0 ? row.snippet : clip(bestMatch.content),
        };
    }
    /** Messages of one session in seq order. */
    sessionMessages(source, sessionId) {
        const rows = this.db.prepare('SELECT source, session_id, seq, msg_id, role, content, ts FROM messages WHERE source = ? AND session_id = ? ORDER BY seq').all(source, sessionId);
        return rows.map(row => ({
            source: row.source,
            sessionId: row.session_id,
            seq: row.seq,
            msgId: row.msg_id,
            role: row.role,
            content: row.content,
            ts: row.ts,
        }));
    }
    /** Messages around a message seq within a session. */
    windowAround(session, seq) {
        const messages = this.sessionMessages(session.source, session.sessionId);
        const index = messages.findIndex(m => m.seq === seq);
        if (index < 0)
            return [];
        const start = Math.max(0, index - WINDOW_BEFORE);
        const end = Math.min(messages.length, index + WINDOW_AFTER + 1);
        return messages.slice(start, end);
    }
    /** Read one session's metadata and a message window. */
    readSession(source, sessionId, aroundSeq, window = 10) {
        const sessionRow = this.db.prepare('SELECT * FROM sessions WHERE source = ? AND session_id = ?').get(source, sessionId);
        const messages = this.sessionMessages(source, sessionId);
        if (sessionRow === undefined)
            return { session: undefined, messages };
        const session = {
            source: sessionRow.source,
            sessionId: sessionRow.session_id,
            path: sessionRow.path,
            title: sessionRow.title,
            cwd: sessionRow.cwd,
            createdAt: sessionRow.created_at,
            updatedAt: sessionRow.updated_at,
            messageCount: sessionRow.msg_count,
            size: sessionRow.size,
            mtime: sessionRow.mtime,
        };
        if (aroundSeq === undefined)
            return { session, messages: messages.slice(-window) };
        const index = messages.findIndex(m => m.seq === aroundSeq);
        if (index < 0)
            return { session, messages: messages.slice(-window) };
        const start = Math.max(0, index - WINDOW_BEFORE);
        const end = Math.min(messages.length, index + WINDOW_AFTER + 1);
        return { session, messages: messages.slice(start, end) };
    }
    /** List sessions in the index, newest first. */
    listSessions(limit = 100) {
        const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit);
        return rows.map(row => ({
            source: row.source,
            sessionId: row.session_id,
            path: row.path,
            title: row.title,
            cwd: row.cwd,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: row.msg_count,
            size: row.size,
            mtime: row.mtime,
        }));
    }
    /** Close the database handle. */
    close() {
        this.db.close();
    }
}
