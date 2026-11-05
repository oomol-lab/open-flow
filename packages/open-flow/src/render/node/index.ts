import type { Browser } from 'playwright-core'
import type { WorkflowFile } from '../../flow/common/workflowFile.ts'
import type { BrowserRenderer, FlowPngOptions, RenderRequest, RenderResponse } from '../common/png.ts'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { decodeWorkflowFile } from '../../flow/common/workflowFile.ts'

export type { WorkflowFile } from '../../flow/common/workflowFile.ts'
export type { FlowPngOptions } from '../common/png.ts'

export interface FlowPngResult extends Omit<RenderResponse, 'dataUrl'> {
  readonly buffer: Buffer
}

/** Render a workflow file without launching or closing the caller's browser. */
export async function flowToPng(browser: Browser, workflow: WorkflowFile, options: FlowPngOptions = {}): Promise<FlowPngResult> {
  const file = decodeWorkflowFile(workflow)
  const packageRoot = dirname(createRequire(import.meta.url).resolve('@oomol-lab/open-flow/package.json'))
  const [script, style] = await Promise.all([
    readFile(join(packageRoot, 'dist/render/browser/runtime.js'), 'utf8'),
    readFile(join(packageRoot, 'dist/render/browser/runtime.css'), 'utf8'),
  ])
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  let failed = false
  try {
    const page = await context.newPage()
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    await page.addStyleTag({ content: style })
    await page.addScriptTag({ content: script })
    const result = await page.evaluate<RenderResponse, string>(
      (serialized) => (globalThis as typeof globalThis & { OpenFlowRenderer: BrowserRenderer }).OpenFlowRenderer.render(JSON.parse(serialized)),
      JSON.stringify({ workflow: file, options } satisfies RenderRequest),
    )
    return {
      buffer: Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64'),
      width: result.width,
      height: result.height,
      hasImagePlaceholders: result.hasImagePlaceholders,
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    await context.close().catch((error: unknown) => {
      if (!failed) throw error
    })
  }
}
