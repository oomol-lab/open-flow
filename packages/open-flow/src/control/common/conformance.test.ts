import type { ControlApiConformanceHarness } from './conformance.ts'

import { expect, it } from 'vitest'
import { connectorControlApiConformanceCases } from './conformance.ts'

const conformance = connectorControlApiConformanceCases.find((test) => test.name == 'lists all authorized Connector Connections with optional Flow scope')!
const connection = { connectionId: 'mail-work', displayName: 'Work', isDefault: true, serviceId: 'mail', status: 'active' }

function harness(respond: (flowId: string | null) => Response): ControlApiConformanceHarness {
  return {
    origin: 'https://control.example',
    async dispose() {},
    async request(request) {
      const url = new URL(request.url)
      if (url.pathname == '/v1/flows' && request.method == 'POST') return Response.json({ flowId: 'flow/1' }, { status: 201 })
      if (url.pathname == '/v1/connector/connections' && request.method == 'GET') {
        if (url.searchParams.get('flowId') == 'conformance.missing') {
          return Response.json({ error: { code: 'flow.not-found', message: 'Flow not found.' }, version: 1 }, { status: 404 })
        }
        return respond(url.searchParams.get('flowId'))
      }
      throw new Error(`Unexpected request: ${request.method} ${url}`)
    },
  }
}

it('accepts all Connections and an empty Flow-scoped list', async () => {
  const scopes: (string | null)[] = []
  await conformance.verify(
    harness((flowId) => {
      scopes.push(flowId)
      return Response.json({ connections: flowId == null ? [connection] : [], version: 1 })
    }),
  )
  expect(scopes).toEqual([null, 'flow/1'])
})

it.each([null, 'flow/1'])('rejects a missing all-Connections route for scope %s', async (scope) => {
  await expect(
    conformance.verify(harness((flowId) => (flowId == scope ? new Response(null, { status: 404 }) : Response.json({ connections: [], version: 1 })))),
  ).rejects.toThrow('expected 200, received 404')
})

it.each([
  { connections: [] },
  { connections: [], version: 2 },
  { connections: {}, version: 1 },
  { connections: [{ ...connection, status: 'invalid' }], version: 1 },
])('rejects an incompatible all-Connections response: %j', async (body) => {
  await expect(conformance.verify(harness(() => Response.json(body)))).rejects.toMatchObject({ code: 'response.invalid' })
})
