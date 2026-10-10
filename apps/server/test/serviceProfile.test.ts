import { expect, it } from 'vitest'
import { validateServiceProfile } from '../common/service-profile.ts'

const custom = { connectorOrigin: 'https://connector.example.com/api', connectorToken: '', consoleOrigin: '', llmOrigin: '', llmToken: '' }

it('allows optional custom services and requires credentials only for a configured LLM', () => {
  expect(validateServiceProfile('custom', custom)).toEqual({})
  expect(validateServiceProfile('custom', { ...custom, llmOrigin: 'https://llm.example.com' })).toEqual({ llmToken: 'required' })
  expect(validateServiceProfile('custom', { ...custom, llmOrigin: 'http://localhost:8080', llmToken: 'saved' })).toEqual({})
})

it('requires a hosted API key and rejects hosted endpoints in the custom profile', () => {
  const hosted = { ...custom, connectorOrigin: 'https://connector.oomol.com' }
  expect(validateServiceProfile('oomol', hosted)).toEqual({ connectorToken: 'required' })
  expect(validateServiceProfile('oomol', { ...hosted, connectorToken: 'saved' })).toEqual({})
  expect(validateServiceProfile('custom', hosted)).toEqual({ connectorOrigin: 'hosted' })
})

it.each(['invalid', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com?x=1', 'https://example.com#part'])(
  'rejects invalid Connector URL %s',
  (connectorOrigin) => {
    expect(validateServiceProfile('custom', { ...custom, connectorOrigin })).toEqual({ connectorOrigin: 'connectorUrl' })
  },
)

it.each(['http://example.com', 'https://example.com/path', 'https://example.com?x=1'])('rejects non-origin service URL %s', (origin) => {
  expect(validateServiceProfile('custom', { ...custom, consoleOrigin: origin, llmOrigin: origin, llmToken: 'token' })).toEqual({
    consoleOrigin: 'origin',
    llmOrigin: 'origin',
  })
})
