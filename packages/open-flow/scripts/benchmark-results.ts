import type { ResultQuery } from '../src/control/common/results.ts'
import type { JsonValue } from '../src/flow/common/change.ts'

import assert from 'node:assert/strict'
import { readResult } from '../src/control/common/results.ts'

// An optional saved module path runs the same fixtures against an earlier implementation.
const baseline = process.argv[2] == null ? undefined : ((await import(process.argv[2])).readResult as typeof readResult)
const cases: Record<string, { value: JsonValue; query: ResultQuery }> = {
  ascii: { value: 'x'.repeat(8 * 1024 * 1024), query: { offset: 100, maxBytes: 1024 * 1024 } },
  unicode: { value: '你😀\\"\n\ud800'.repeat(300000), query: { offset: 100, maxBytes: 65536 } },
  late: { value: 'x'.repeat(8 * 1024 * 1024), query: { offset: 8000000, maxBytes: 15000 } },
  completeRecords: { value: Array.from({ length: 100 }, (_, id) => ({ id, text: '你'.repeat(1000) })), query: { limit: 100, maxBytes: 1024 * 1024 } },
  pagedRecords: { value: Array.from({ length: 1000 }, (_, id) => ({ id, text: '你'.repeat(1000) })), query: { offset: 1, limit: 100, maxBytes: 1024 * 1024 } },
}
for (const [scenario, { value, query }] of Object.entries(cases)) {
  const page = readResult(value, query)
  assert.ok(new TextEncoder().encode(JSON.stringify(page)).byteLength <= query.maxBytes!)
  if (baseline != null) assert.deepEqual(page, baseline(value, query))
  for (const [mode, read] of [...(baseline == null ? [] : [['before', baseline] as const]), ['after', readResult] as const]) {
    for (let index = 0; index < 3; index++) read(value, query)
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      const start = process.cpuUsage()
      for (let index = 0; index < 10; index++) read(value, query)
      const elapsed = process.cpuUsage(start)
      samples.push((elapsed.user + elapsed.system) / 10000)
    }
    console.log(JSON.stringify({ scenario, mode, cpuMsMedian: samples.toSorted((left, right) => left - right)[2] }))
  }
}
