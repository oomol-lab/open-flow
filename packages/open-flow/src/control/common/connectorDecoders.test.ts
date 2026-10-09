import { expect, it } from 'vitest'
import { connectorAccess, connectorAccessSnapshot, connectorAccessCandidates, connectorAccessCandidatesBatch } from './connectorDecoders.ts'

const candidate = {
  accessBindingId: 'binding',
  connectionId: 'account',
  providerId: 'mail',
  connectionDisplayName: 'Work',
  permissionGroupName: null,
  source: { kind: 'policy', ruleId: null },
}
const response = (binding: unknown) => ({ candidates: [binding], mode: 'selectable', providerId: 'mail', version: 1 })

const snapshot = { version: 2, mode: 'selectable', sharedAccessDigest: 'shared', sharedBindings: [], selectedBindings: [candidate] }

const permissions = { actionIds: [], allActions: true, triggerIds: [], allTriggers: true, configured: false, proxy: true }

it('accepts administrator candidates with complete action and trigger permissions', () => {
  const value = { results: [response({ ...candidate, source: { kind: 'admin-delegation' }, isDefault: true, permissions })], version: 1 }
  expect(connectorAccessCandidatesBatch(value, ['mail'])).toEqual(value)
})

it.each([
  [{ ...permissions, allTriggers: 'true' }, 'permissions.allTriggers: expected a boolean.'],
  [{ ...permissions, allActions: false }, 'permissions.proxy: requires allActions=true, allTriggers=true and configured=false.'],
  [{ ...permissions, triggerIds: ['trigger'] }, 'permissions.triggerIds: must be empty when allTriggers is true.'],
  [{ ...permissions, triggerIds: ['trigger', 'trigger'] }, 'permissions.triggerIds: duplicate IDs.'],
  [{ ...permissions, extra: 'private value' }, 'Unexpected fields: extra.'],
  [{ actionIds: [], allActions: true, configured: false, proxy: true }, 'Missing fields: triggerIds, allTriggers.'],
])('explains invalid permission summaries %#', (summary, detail) => {
  expect(() => connectorAccessCandidates(response({ ...candidate, permissions: summary }), 'mail')).toThrow(expect.objectContaining({ detail }))
})

it.each([
  [{ results: [], version: 1 }, 'results: missing requested providers.'],
  [{ results: [response(candidate), response(candidate)], version: 1 }, 'results[].providerId: duplicate or unrequested provider.'],
  [{ results: [response(candidate)], version: 2 }, 'version: expected 1.'],
])('explains incompatible candidate batches %#', (value, detail) => {
  expect(() => connectorAccessCandidatesBatch(value, ['mail'])).toThrow(expect.objectContaining({ detail }))
})

it('decodes fixed access separately from editable shared configuration', () => {
  expect(connectorAccessSnapshot(snapshot)).toEqual(snapshot)
  expect(() => connectorAccess(snapshot)).toThrow()
  expect(() => connectorAccessSnapshot({ accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'shared', version: 1 })).toThrow()
})

it.each([
  { ...snapshot, selectedBindings: undefined },
  { ...snapshot, sharedBindings: undefined },
  { ...snapshot, selectedBindings: [candidate, candidate] },
  { ...snapshot, selectedBindings: [{ ...candidate, source: null }] },
  { ...snapshot, selectedBindings: [{ ...candidate, status: 'active' }] },
  { ...snapshot, selectedBindings: [{ ...candidate, connectionId: null }] },
  { ...snapshot, mode: 'implicit' },
])('rejects incomplete or invalid execution authority %#', (value) => {
  expect(() => connectorAccessSnapshot(value)).toThrow()
})

it.each([{ kind: 'policy', ruleId: null }, { kind: 'policy', ruleId: 'team-admin' }, { kind: 'admin-delegation' }])(
  'preserves explicit access source %j',
  (source) => {
    expect(connectorAccessCandidates(response({ ...candidate, source }), 'mail').candidates[0]).toEqual({ ...candidate, source })
  },
)

it.each([
  { ...candidate, source: undefined },
  { ...candidate, source: { kind: 'policy' } },
  { ...candidate, source: { kind: 'admin-delegation', ruleId: 'team-admin' } },
  { ...candidate, connectionId: '' },
])('rejects incomplete or ambiguous binding identities', (binding) => {
  expect(() => connectorAccessCandidates(response(binding), 'mail')).toThrow(expect.objectContaining({ code: 'response.invalid' }))
})

it('keeps valid bindings and exposes old or malformed identities only as invalid display records', () => {
  const current = { ...candidate, status: 'active' }
  const legacy = { accessBindingId: 'old', providerId: 'mail', connectionDisplayName: 'Old account', permissionGroupName: 'Readers', status: 'active' }
  const access = connectorAccess({
    version: 1,
    mode: 'selectable',
    accessRevision: 7,
    sharedAccessDigest: 'saved',
    bindings: [current, legacy, { ...current, accessBindingId: 'broken', source: { kind: 'admin-delegation', ruleId: 'forged' } }, null],
  })
  expect(access.bindings[0]).toEqual(current)
  expect(access.bindings[1]).toEqual({ ...legacy, connectionId: null, source: null, status: 'invalid' })
  expect(access.bindings[2]).toMatchObject({ accessBindingId: 'broken', connectionId: null, source: null, status: 'invalid' })
  expect(access.discardedBindingCount).toBe(1)
  expect(access.accessRevision).toBe(7)
  expect(access.sharedAccessDigest).toBe('saved')
  expect(connectorAccess(access)).toEqual(access)
})

it.each([null, { bindings: [] }, { version: 1, mode: 'selectable', accessRevision: 0, sharedAccessDigest: 'saved', bindings: {} }])(
  'still rejects invalid response envelopes',
  (envelope) => {
    expect(() => connectorAccess(envelope)).toThrow(expect.objectContaining({ code: 'response.invalid' }))
  },
)
