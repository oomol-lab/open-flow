import type { CollectionItem } from './collectionSearch.ts'

import { describe, expect, it } from 'vitest'
import { filterCollectionItems, mergeCollectionItems } from './collectionSearch.ts'

const items: CollectionItem[] = [
  { label: 'Blocks', type: 'divider' },
  { description: 'Run source code.', label: 'JavaScript', type: 'block' },
  { label: 'Triggers', type: 'divider' },
  { description: 'Receive an HTTP request.', label: 'Webhook', type: 'trigger' },
]

describe('block picker items', () => {
  it('matches labels, descriptions, and complete groups without leaving empty dividers', () => {
    expect(filterCollectionItems('source', items).map((item) => item.label)).toEqual(['Blocks', 'JavaScript'])
    expect(filterCollectionItems('webhook', items).map((item) => item.label)).toEqual(['Triggers', 'Webhook'])
    expect(filterCollectionItems('triggers', items).map((item) => item.label)).toEqual(['Triggers', 'Webhook'])
    expect(filterCollectionItems('missing', items)).toEqual([])
  })

  it('preserves stable item indexes when filtering an indexed catalog again', () => {
    const indexed = filterCollectionItems('', items)
    expect(filterCollectionItems('webhook', indexed).map(({ index, label }) => ({ index, label }))).toEqual([
      { index: 2, label: 'Triggers' },
      { index: 3, label: 'Webhook' },
    ])
  })

  it('merges asynchronous results into their existing groups in provider order', () => {
    const local = filterCollectionItems('', items)
    const additions = filterCollectionItems('', [
      { label: 'Triggers', type: 'divider' },
      { label: 'GitHub issue', type: 'trigger' },
      { label: 'Connectors', type: 'divider' },
      { label: 'Send email', type: 'connector' },
    ]).map((item, index) => Object.assign({}, item, { index: items.length + index }))

    expect(mergeCollectionItems(local, additions).map((item) => item.label)).toEqual([
      'Blocks',
      'JavaScript',
      'Triggers',
      'Webhook',
      'GitHub issue',
      'Connectors',
      'Send email',
    ])
  })
})
