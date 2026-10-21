import { expect, it } from 'vitest'
import triggers from '../../trigger/providers/catalog.generated.json' with { type: 'json' }
import sources from './catalog.generated.json' with { type: 'json' }

it('keeps lightweight source metadata aligned with the Connector catalog', () => {
  expect(sources).toEqual(
    triggers.flatMap((entry) => {
      if (!('source' in entry) || entry.source == null) return []
      const { createSchema: _create, updateSchema: _update, ...metadata } = entry.source
      return [{ key: entry.snapshot.key, ...metadata }]
    }),
  )
})
