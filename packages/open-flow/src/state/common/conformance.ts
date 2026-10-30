import type { JsonValue } from '../../flow/common/model.ts'
import type { DedupeConfig } from './state.ts'

import { dequal } from 'dequal/lite'

export interface StateConformanceHarness {
  readonly maxIdentities: number
  /** Executes Code on the same initially empty Flow and scope on every call; returns its `result` output. */
  run(source: string): Promise<JsonValue>
  /** Executes the same dedupe node across Runs, updating its business config and items. */
  dedupe(config: DedupeConfig, items: JsonValue[]): Promise<{ items: JsonValue[]; duplicates: JsonValue[] }>
}

export const stateConformanceCases: readonly { name: string; verify(harness: StateConformanceHarness): Promise<void> }[] = [
  {
    name: 'persists watermarks by instant and resets changed modes atomically',
    async verify(harness) {
      const config: DedupeConfig = { field: '', mode: 'increasing', space: 'node' }
      const first = await harness.dedupe(config, ['2026-10-30T09:00:00+08:00', '2026-10-30T01:00:00Z', '2026-10-30T02:00:00Z'])
      if (!dequal(first, { items: ['2026-10-30T09:00:00+08:00', '2026-10-30T02:00:00Z'], duplicates: ['2026-10-30T01:00:00Z'] }))
        throw new Error('Watermarks must compare instants and preserve item order.')
      let rejected = false
      try {
        await harness.dedupe(config, [1])
      } catch {
        rejected = true
      }
      if (!rejected) throw new Error('Mixed watermark types must fail.')
      const second = await harness.dedupe(config, ['2026-10-30T02:00:00Z', '2026-10-30T03:00:00Z'])
      if (!dequal(second, { items: ['2026-10-30T03:00:00Z'], duplicates: ['2026-10-30T02:00:00Z'] }))
        throw new Error('A failed batch must preserve the previous watermark.')
      await harness.dedupe({ ...config, mode: 'new' }, [])
      const reset = await harness.dedupe(config, [5, 3, 5])
      if (!dequal(reset, { items: [5, 3], duplicates: [5] })) throw new Error('A mode reset must discard previous watermarks, including on empty batches.')
    },
  },
  {
    name: 'round-trips independent JSON values and deletes without exposing stored references',
    async verify(harness) {
      const result = await harness.run(`export default async (_, context) => {
        await context.state.set('b', { nested: [1, null, false] });
        const copy = await context.state.get('b');
        copy.nested.push(2);
        const retained = await context.state.get('b');
        const inserted = await context.state.insert('b', 'replacement');
        await context.state.set('a', 0);
        const keys = await context.state.list();
        await context.state.delete('a');
        await context.state.set('b', null);
        return {result: {retained, inserted, keys, missing: await context.state.get('a'), remaining: await context.state.list()}};
      }`)
      if (!dequal(result, { retained: { nested: [1, null, false] }, inserted: false, keys: ['a', 'b'], missing: null, remaining: [] }))
        throw new Error('State JSON round-trip, conditional insertion or deletion differs from the contract.')
    },
  },
  {
    name: 'persists explicit values and dedupe history across Runs',
    async verify(harness) {
      const source = `export default async (_, context) => {
        const first = await context.state.insert('count', 0);
        const count = await context.state.get('count');
        await context.state.set('count', count + 1);
        return { result: { first, count, ids: await context.dedupe.insert(['a', 'a']) } };
      }`
      if (
        !dequal(await harness.run(source), { first: true, count: 0, ids: [true, false] }) ||
        !dequal(await harness.run(source), { first: false, count: 1, ids: [false, false] })
      )
        throw new Error('State must persist across Runs without replacing existing values on insert.')
    },
  },
  {
    name: 'rejects a full batch atomically while permitting duplicates at capacity',
    async verify(harness) {
      const result = await harness.run(`export default async (_, context) => {
        const ids = Array.from({length: ${harness.maxIdentities}}, (_, index) => index);
        await context.dedupe.insert(ids);
        let error;
        try { await context.dedupe.insert([0, 'extra']); } catch (failure) { error = failure.code; }
        return { result: { error, extra: await context.dedupe.has(['extra']), duplicate: await context.dedupe.insert([0, 0]) } };
      }`)
      if (!dequal(result, { error: 'dedupe.full', extra: [false], duplicate: [false, false] }))
        throw new Error('Dedupe capacity must fail atomically and preserve duplicate membership.')
    },
  },
]
