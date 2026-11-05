import type { Browser } from 'playwright-core'
import type { WorkflowFile } from '../../flow/common/workflowFile.ts'

import { readFile } from 'node:fs/promises'
import { beforeEach, expect, it, vi } from 'vitest'
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
  const page = { setContent: vi.fn(), addStyleTag: vi.fn(), addScriptTag: vi.fn(), evaluate }
  const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) }
  const browser = { newContext: vi.fn().mockResolvedValue(context), close: vi.fn() }
  return { browser, context, page, render: (file = workflow) => flowToPng(browser as unknown as Browser, file, { dark: true, frame: true }) }
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
