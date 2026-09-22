import { expect, it } from 'vitest'
import { connectorAccess, connectorAccessCandidates } from './connectorDecoders.ts'

const candidate = {
  accessBindingId: 'binding',
  connectionId: 'account',
  providerId: 'mail',
  connectionDisplayName: 'Work',
  permissionGroupName: null,
  source: { kind: 'policy', ruleId: null },
}
const response = (binding: unknown) => ({ candidates: [binding], mode: 'selectable', providerId: 'mail', version: 1 })

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
    providerAccessDigest: 'saved',
    bindings: [current, legacy, { ...current, accessBindingId: 'broken', source: { kind: 'admin-delegation', ruleId: 'forged' } }, null],
  })
  expect(access.bindings[0]).toEqual(current)
  expect(access.bindings[1]).toEqual({ ...legacy, connectionId: null, source: null, status: 'invalid' })
  expect(access.bindings[2]).toMatchObject({ accessBindingId: 'broken', connectionId: null, source: null, status: 'invalid' })
  expect(access.discardedBindingCount).toBe(1)
  expect(access.accessRevision).toBe(7)
  expect(access.providerAccessDigest).toBe('saved')
  expect(connectorAccess(access)).toEqual(access)
})

it.each([null, { bindings: [] }, { version: 1, mode: 'selectable', accessRevision: 0, providerAccessDigest: 'saved', bindings: {} }])(
  'still rejects invalid response envelopes',
  (envelope) => {
    expect(() => connectorAccess(envelope)).toThrow(expect.objectContaining({ code: 'response.invalid' }))
  },
)
