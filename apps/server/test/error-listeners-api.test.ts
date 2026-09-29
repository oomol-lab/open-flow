import type { ControlService } from '../node/application/control-service.ts'

import { expect, it, vi } from 'vitest'
import { ControlError } from '../node/error.ts'
import { createControlApp } from '../node/transport/control.ts'

it('authenticates listener lookups and returns the complete service response', async () => {
  const listeners = [{ flowId: 'handler', flowName: 'Alerts', nodeId: 'error', nodeName: 'Failure', enabled: false }]
  const getErrorListeners = vi.fn(() => ({ version: 1, listeners }))
  let authorized = false
  const app = createControlApp({ getErrorListeners } as unknown as ControlService, () => (authorized ? 'actor' : undefined)).onError((error) =>
    Response.json({ error: { message: error.message } }, { status: error instanceof ControlError ? error.status : 500 }),
  )
  expect((await app.request('/flows/source/error-listeners')).status).toBe(401)
  expect(getErrorListeners).not.toHaveBeenCalled()
  authorized = true
  const response = await app.request('/flows/source/error-listeners')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ version: 1, listeners })
  expect(getErrorListeners).toHaveBeenCalledWith('source')
  expect((await app.request('/flows/source/error-listeners?limit=1')).status).toBe(400)
})
