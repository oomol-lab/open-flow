import type { ResultCall, ResultInfo } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { DatabaseSync } from 'node:sqlite'

import { canonicalJsonBytes } from '@oomol-lab/open-flow/flow-encoding'
import { createHash, randomUUID } from 'node:crypto'
import { insert } from './insert.ts'

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

interface Row extends Omit<ResultInfo, 'source'> {
  readonly source: string
}

function info(row: Row): ResultInfo {
  return { ...row, source: JSON.parse(row.source) as ResultInfo['source'] }
}

const columns = 'result_id AS resultId, call_id AS callId, tool_id AS toolId, source, bytes, digest, created_at AS createdAt'

export class ResultStore {
  readonly #database: DatabaseSync
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value) {
    this.#database = database
    this.#transaction = transaction
  }

  put(runId: string, invocationId: string, callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>, value: JsonValue): ResultInfo {
    const content = JSON.stringify(value)
    const bytes = Buffer.byteLength(content)
    if (bytes > 32 * 1024 * 1024) throw new Error('The completed tool result exceeds the 32 MiB storage limit.')
    const inputDigest = digest(
      canonicalJsonBytes(tool.kind == 'connector' ? { action: tool.action, connectionId: tool.connectionId ?? null, input } : { kind: 'code', input }),
    )
    const result: ResultInfo = {
      resultId: randomUUID(),
      callId,
      toolId: tool.id,
      source: tool.kind == 'code' ? { kind: 'code' } : { kind: 'connector', action: tool.action },
      bytes,
      digest: digest(content),
      createdAt: new Date().toISOString(),
    }
    return this.#transaction(() => {
      const run = this.#database.prepare('SELECT status FROM runs WHERE run_id = ?').get(runId)
      if (run?.status != 'running') throw new Error('The Run no longer accepts tool results.')
      const previous = this.#database
        .prepare(`SELECT ${columns}, input_digest AS inputDigest FROM run_results WHERE run_id = ? AND invocation_id = ? AND call_id = ?`)
        .get(runId, invocationId, callId) as (Row & { inputDigest: string }) | undefined
      if (previous != null) {
        if (previous.inputDigest != inputDigest || previous.digest != result.digest || previous.toolId != tool.id)
          throw new Error('Stored tool call identity changed.')
        const { inputDigest: _inputDigest, ...row } = previous
        return info(row)
      }
      const total = this.#database.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM run_results WHERE run_id = ?').get(runId)
      if (Number(total?.bytes) + bytes > 128 * 1024 * 1024) throw new Error('The Run exceeds the 128 MiB tool result storage limit.')
      insert(this.#database, 'run_results', {
        result_id: result.resultId,
        run_id: runId,
        invocation_id: invocationId,
        call_id: callId,
        tool_id: tool.id,
        source: JSON.stringify(result.source),
        input_digest: inputDigest,
        digest: result.digest,
        bytes,
        content,
        created_at: result.createdAt,
      })
      return result
    })
  }

  find(runId: string, invocationId: string, callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>) {
    const row = this.#database
      .prepare(
        'SELECT result_id AS resultId, input_digest AS inputDigest, tool_id AS toolId FROM run_results WHERE run_id = ? AND invocation_id = ? AND call_id = ?',
      )
      .get(runId, invocationId, callId)
    if (row == null) return
    const expected = digest(
      canonicalJsonBytes(tool.kind == 'connector' ? { action: tool.action, connectionId: tool.connectionId ?? null, input } : { kind: 'code', input }),
    )
    if (row.inputDigest != expected || row.toolId != tool.id) throw new Error('Stored tool call identity changed.')
    return this.get(runId, String(row.resultId), invocationId)
  }

  list(runId: string, after = ''): { results: readonly ResultInfo[]; nextAfter?: string } {
    const rows = this.#database
      .prepare(`SELECT ${columns} FROM run_results WHERE run_id = ? AND result_id > ? ORDER BY result_id LIMIT 51`)
      .all(runId, after) as unknown as Row[]
    const results = rows.slice(0, 50).map(info)
    return { results, ...(rows.length > 50 ? { nextAfter: results.at(-1)?.resultId } : {}) }
  }

  get(runId: string, resultId: string, invocationId?: string): { result: ResultInfo; content: string } | undefined {
    const row = this.#database
      .prepare(`SELECT ${columns}, content, invocation_id AS invocationId FROM run_results WHERE run_id = ? AND result_id = ?`)
      .get(runId, resultId) as (Row & { content: string; invocationId: string }) | undefined
    if (row == null || (invocationId != null && row.invocationId != invocationId)) return
    const { content, invocationId: _invocationId, ...result } = row
    if (digest(content) != result.digest) throw new Error('Stored tool result digest does not match.')
    return { result: info(result), content }
  }
}
