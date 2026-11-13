import type { Browser, Route } from 'playwright-core'
import type { WorkflowFile } from '../../flow/common/workflowFile.ts'
import type { FlowPngOptions } from './index.ts'

import { readFile } from 'node:fs/promises'
import { beforeEach, expect, it, vi } from 'vitest'
import { ProviderIconCache } from '../../connector/common/providerIconCache.ts'
import { ControlClient } from '../../control/common/api.ts'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { flowToPng } from './index.ts'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const workflow: WorkflowFile = {
  kind: 'open-flow-workflow',
  version: 1,
  name: '中文 workflow',
  content: { modelVersion: currentFlowModelVersion, document: { bindings: {}, graph: { nodes: {}, edges: [] } }, modules: {} },
}

function renderer() {
  const evaluate = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,cG5n', width: 800, height: 400, hasImagePlaceholders: true })
  const page = { setContent: vi.fn(), exposeFunction: vi.fn(), addStyleTag: vi.fn(), addScriptTag: vi.fn(), evaluate }
  const context = { route: vi.fn().mockResolvedValue(undefined), newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) }
  const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn() }
  return {
    browser,
    context,
    page,
    render: (file = workflow, options: FlowPngOptions = { dark: true, frame: true }) => flowToPng(browser as unknown as Browser, file, options),
  }
}

beforeEach(() => {
  vi.mocked(readFile).mockReset().mockResolvedValue('bundled resource')
})

it('returns PNG bytes and metadata without changing the file or closing the caller browser', async () => {
  const view = renderer()
  const before = structuredClone(workflow)
  const result = await view.render()
  expect(result).toEqual({ buffer: Buffer.from('png'), width: 800, height: 400, hasImagePlaceholders: true })
  expect(view.page.evaluate).toHaveBeenCalledWith(expect.any(Function), JSON.stringify({ workflow: before, options: { dark: true, frame: true } }))
  expect(view.context.close).toHaveBeenCalledOnce()
  expect(view.browser.close).not.toHaveBeenCalled()
  expect(workflow).toEqual(before)
})

it.each([undefined, true])('allows remote resources when allowNetwork is %s', async (allowNetwork) => {
  const view = renderer()
  await view.render(workflow, { allowNetwork })
  expect(view.context.route).not.toHaveBeenCalled()
})

it('blocks requests on its own context before creating the page when network access is disabled', async () => {
  const view = renderer()
  await view.render(workflow, { allowNetwork: false })
  expect(view.browser.newContext).toHaveBeenCalledWith({ deviceScaleFactor: 1, serviceWorkers: 'block' })
  expect(view.context.route).toHaveBeenCalledWith('**/*', expect.any(Function))
  expect(view.context.route.mock.invocationCallOrder[0]).toBeLessThan(view.context.newPage.mock.invocationCallOrder[0]!)
  const block = view.context.route.mock.calls[0]![1] as (route: Pick<Route, 'abort'>) => Promise<void>
  const request = { abort: vi.fn().mockResolvedValue(undefined) }
  await block(request)
  expect(request.abort).toHaveBeenCalledOnce()
})

it('closes its context without creating a page if network policy setup fails', async () => {
  const view = renderer()
  const error = new Error('Could not install network policy')
  view.context.route.mockRejectedValueOnce(error)
  await expect(view.render(workflow, { allowNetwork: false })).rejects.toBe(error)
  expect(view.context.newPage).not.toHaveBeenCalled()
  expect(view.context.close).toHaveBeenCalledOnce()
  expect(view.browser.close).not.toHaveBeenCalled()
})

it.each(['newPage', 'addStyleTag', 'addScriptTag', 'evaluate'] as const)('closes its context when %s fails', async (operation) => {
  const view = renderer()
  const error = new Error(operation)
  if (operation === 'newPage') view.context.newPage.mockRejectedValueOnce(error)
  else view.page[operation].mockRejectedValueOnce(error)
  await expect(view.render()).rejects.toBe(error)
  expect(view.context.close).toHaveBeenCalledOnce()
  expect(view.browser.close).not.toHaveBeenCalled()
})

it('preserves the rendering failure if cleanup also fails', async () => {
  const view = renderer()
  const error = new Error('Renderer disconnected')
  view.page.evaluate.mockRejectedValueOnce(error)
  view.context.close.mockRejectedValueOnce(new Error('Context disconnected'))
  await expect(view.render()).rejects.toBe(error)
})

it.each([{}, { ...workflow, version: 2 }, JSON.stringify(workflow)])('rejects invalid files before creating browser resources (%j)', async (file) => {
  const view = renderer()
  await expect(view.render(file as WorkflowFile)).rejects.toThrow()
  expect(view.browser.newContext).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
})

it('can reuse a browser after a failed call', async () => {
  const view = renderer()
  const nextContext = { newPage: vi.fn().mockResolvedValue(view.page), close: vi.fn().mockResolvedValue(undefined) }
  view.browser.newContext.mockResolvedValueOnce(view.context).mockResolvedValueOnce(nextContext)
  view.page.evaluate.mockRejectedValueOnce(new Error('Bad image'))
  await expect(view.render()).rejects.toThrow('Bad image')
  expect((await view.render()).buffer.toString()).toBe('png')
  expect(view.context.close).toHaveBeenCalledOnce()
  expect(nextContext.close).toHaveBeenCalledOnce()
  expect(view.browser.close).not.toHaveBeenCalled()
})

it.each(['original', 'compact'] as const)('forwards the %s layout through the Node renderer', async (layout) => {
  const view = renderer()
  await view.render(workflow, { layout })
  expect(view.page.evaluate).toHaveBeenCalledWith(expect.any(Function), JSON.stringify({ workflow, options: { layout } }))
})

it.each(['auto', '1:1', '4:3', '3:4', '16:9', '9:16'] as const)('forwards the %s canvas ratio', async (aspectRatio) => {
  const view = renderer()
  await view.render(workflow, { layout: 'compact', aspectRatio })
  expect(view.page.evaluate).toHaveBeenCalledWith(expect.any(Function), JSON.stringify({ workflow, options: { layout: 'compact', aspectRatio } }))
})

it('rejects unsupported canvas ratios before allocating a browser context', async () => {
  const view = renderer()
  await expect(view.render(workflow, { aspectRatio: '17:2' as FlowPngOptions['aspectRatio'] })).rejects.toThrow('aspect ratio')
  expect(view.browser.newContext).not.toHaveBeenCalled()
})

it.each([true, false])('bridges the cached Provider resources without serializing client objects (allowNetwork=%s)', async (allowNetwork) => {
  const records = new Map()
  const request = vi.fn(async () => Response.json({ version: 1, providers: [{ serviceId: 'mail', serviceName: 'Mail' }] }))
  const client = new ControlClient(request, 'api', {
    cache: {
      scope: 'test',
      delegate: {
        get: async (key) => records.get(key),
        set: async (key, value) => {
          records.set(key, value)
        },
        delete: async (key) => {
          records.delete(key)
        },
      },
    },
  })
  await client.listConnectorProviders(undefined, undefined, 'en')
  const iconCache = new ProviderIconCache({ scope: 'test' })
  const get = vi.spyOn(iconCache, 'getBlob').mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  const file: WorkflowFile = {
    ...workflow,
    content: {
      ...workflow.content,
      document: {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            mail: {
              kind: 'task',
              name: 'Read mail',
              inputs: {},
              task: { name: 'Read', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.read' } },
            },
          },
        },
      },
    },
  }
  const view = renderer()
  await view.render(file, { client, iconCache, allowNetwork })
  const payload = JSON.parse(view.page.evaluate.mock.calls[0]![1])
  expect(payload.providers).toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
  expect(payload.options).toEqual({ allowNetwork })
  expect(request).toHaveBeenCalledTimes(1)
  const load = view.page.exposeFunction.mock.calls[0]![1]
  const source = { kind: 'image', providerId: 'mail', url: 'https://example.test/mail.png' }
  expect(await load(source)).toEqual({ bytes: [112, 110, 103], contentType: 'image/png' })
  expect(get).toHaveBeenCalledWith(source, { allowNetwork })
})

it('loads Provider metadata for a Code-only workflow with Connector action hints', async () => {
  const client = new ControlClient(async () => Response.json({ version: 1, providers: [{ serviceId: 'mail', serviceName: 'Mail' }] }))
  const file: WorkflowFile = {
    ...workflow,
    content: {
      ...workflow.content,
      modules: { code: { name: 'Code', imports: [], source: 'export default () => ({})' } },
      document: {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            code: {
              kind: 'task',
              inputs: {},
              task: { name: 'Code', moduleId: 'code', inputs: [], outputs: [], capabilities: [{ kind: 'connector', actionHints: ['mail.read'] }] },
            },
          },
        },
      },
    },
  }
  const view = renderer()
  await view.render(file, { client })
  expect(JSON.parse(view.page.evaluate.mock.calls[0]![1]).providers).toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
})

it('keeps PNG rendering quiet when optional Provider metadata cannot be loaded', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const client = new ControlClient(async () => {
      throw new Error('Private Provider connection details')
    })
    const file: WorkflowFile = {
      ...workflow,
      content: {
        ...workflow.content,
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              mail: { kind: 'task', inputs: {}, task: { name: 'Read', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.read' } } },
            },
          },
        },
      },
    }
    const view = renderer()
    expect((await view.render(file, { client })).buffer.toString()).toBe('png')
    expect(JSON.parse(view.page.evaluate.mock.calls[0]![1]).providers).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
})
