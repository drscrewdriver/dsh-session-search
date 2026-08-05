#!/usr/bin/env node
/**
 * Regression test: dsh session logs are concatenated zstd frames — one
 * independent frame per appended event batch (the layout owned by
 * `dsh-session-persistence-jsonl`). A single `zstdDecompressSync` call
 * decodes only the first frame, so pre-fix `parseDsh()` indexed dsh sessions
 * with zero messages. Frames must be scanned structurally and decoded one at
 * a time; a torn final frame (interrupted write) is skipped, not fatal.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { parseDsh } from '../lib/parsers.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-session-search-frames-'))
try {
  const frame = (lines) => zstdCompressSync(`${lines.join('\n')}\n`)
  const sessionLine = '{"type":"session","id":"s1","cwd":"/work","createdAt":1}'
  const user = (text, t) =>
    `{"type":"user/message","data":{"content":[{"type":"text","text":"${text}"}]},"time":${t}}`
  const assistant = (text, t) =>
    `{"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"${text}"}]}},"time":${t}}`

  // Two frames, each carrying its own message.
  const multiPath = join(dir, 'multi.jsonl.zstd')
  writeFileSync(multiPath, Buffer.concat([
    frame([sessionLine, user('hello from frame one', 100)]),
    frame([assistant('reply from frame two', 200)]),
  ]))
  const multiContents = (await parseDsh(multiPath)).messages.map(m => m.content)
  if (!multiContents.includes('hello from frame one') || !multiContents.includes('reply from frame two')) {
    throw new Error(`multi-frame parse lost messages: ${JSON.stringify(multiContents)}`)
  }

  // Torn final frame: an interrupted append must be skipped, not fail the file.
  const tornPath = join(dir, 'torn.jsonl.zstd')
  writeFileSync(tornPath, Buffer.concat([
    Buffer.concat([
      frame([sessionLine, user('hello from frame one', 100)]),
      frame([assistant('reply from frame two', 200)]),
    ]),
    frame([user('never completes', 300)]).subarray(0, 5),
  ]))
  const tornContents = (await parseDsh(tornPath)).messages.map(m => m.content)
  if (!tornContents.includes('hello from frame one') || tornContents.includes('never completes')) {
    throw new Error(`torn-frame handling wrong: ${JSON.stringify(tornContents)}`)
  }

  // Single frame still parses (backward compatibility).
  const singlePath = join(dir, 'single.jsonl.zstd')
  writeFileSync(singlePath, frame([sessionLine, user('only frame', 300)]))
  const singleContents = (await parseDsh(singlePath)).messages.map(m => m.content)
  if (singleContents.length !== 1 || singleContents[0] !== 'only frame') {
    throw new Error(`single-frame parse wrong: ${JSON.stringify(singleContents)}`)
  }

  console.log('dsh-frames: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
