import type { JsonValue } from '../../flow/common/model.ts'
import type { SkipDuplicatesConfig } from './state.ts'

import { dequal } from 'dequal/lite'

export interface StateConformanceHarness {
  readonly maxIdentities: number
  /** Executes Code on the same initially empty Flow and scope on every call; returns its `result` output. */
  run(source: string): Promise<JsonValue>
  /** Executes the same Skip Duplicates node across Runs, updating its business config and items. */
  skipDuplicates(config: SkipDuplicatesConfig, items: JsonValue[]): Promise<{ items: JsonValue[]; duplicates: JsonValue[] }>
}

export const stateConformanceCases: readonly { name: string; verify(harness: StateConformanceHarness): Promise<void> }[] = [
  {
    name: 'reads selected State keys in input order with missing, falsy and independent values',
    async verify(harness) {
      const result = await harness.run(`export default async (_, context) => {
        await context.state.set('object', { nested: [1] });
        await context.state.set('zero', 0);
        await context.state.set('false', false);
        await context.state.set('empty', '');
        const values = await context.state.get(['false', 'missing', 'object', 'zero', 'empty']);
        values[2].nested.push(2);
        return {result: {values, retained: await context.state.get('object'), zero: await context.state.get('zero')}};
      }`)
      if (!dequal(result, { values: [false, null, { nested: [1, 2] }, 0, ''], retained: { nested: [1] }, zero: 0 }))
        throw new Error('State batch reads must preserve order, missing keys and independent JSON values.')
    },
  },
  {
    name: 'skips composite identities across successful Runs without depending on field order',
    async verify(harness) {
      const items = [
        { company: 'a', id: 1 },
        { company: 'b', id: 1 },
        { company: 'a', id: 1 },
      ]
      const first = await harness.skipDuplicates({ fields: ['company', 'id'] }, items)
      if (!dequal(first, { items: items.slice(0, 2), duplicates: [items[2]] }))
        throw new Error('Composite identities must retain the first item in input order.')
      const second = await harness.skipDuplicates({ fields: ['id', 'company'] }, items)
      if (!dequal(second, { items: [], duplicates: items })) throw new Error('Successful Run history must persist independently of field order.')
      const changed = await harness.skipDuplicates({ fields: ['id'] }, items)
      if (!dequal(changed, { items: [items[0]], duplicates: items.slice(1) })) throw new Error('The field definition must participate in identity.')
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
