import type { Draft } from '../api.ts'

import { expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { deriveAddNodeOptions } from './addNodeOptions.ts'

it('offers a manual trigger again after the existing one is removed', () => {
  const draft: Draft = {
    actorId: 'actor',
    createdAt: '2026-09-07T00:00:00.000Z',
    digest: 'digest',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'revision',
    version: 1,
    content: {
      modelVersion: 1,
      modules: {},
      document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } } },
    },
  }
  const t = createI18n('en').t
  const options = deriveAddNodeOptions(draft, { kind: 'flow' }, t)
  expect(options.some((option) => option.id == 'trigger:manual')).toBe(false)
  expect(options.some((option) => option.id == 'trigger:webhook')).toBe(true)
  expect(options.some((option) => option.id == 'trigger:cron')).toBe(true)
  const cleared: Draft = { ...draft, content: { ...draft.content, document: { ...draft.content.document, graph: { edges: [], nodes: {} } } } }
  expect(deriveAddNodeOptions(cleared, { kind: 'flow' }, t).some((option) => option.id == 'trigger:manual')).toBe(true)
})
