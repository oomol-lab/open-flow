import type { Browser } from 'playwright-core'
import type { ProviderIconRequest } from '../../connector/common/providerIconCache.ts'
import type { ControlClient, ConnectorProvider } from '../../control/common/api.ts'
import type { WorkflowFile } from '../../flow/common/workflowFile.ts'
import type { FlowPngOptions as RenderOptions, RendererGlobals, RenderRequest, RenderResponse } from '../common/png.ts'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ProviderIconCache } from '../../connector/common/providerIconCache.ts'
import { connectionUsage } from '../../flow/common/connectionUsage.ts'
import { codeActions } from '../../flow/common/semantics.ts'
import { decodeWorkflowFile } from '../../flow/common/workflowFile.ts'
import { getFlowPngAspectRatio } from '../common/png.ts'

export type { WorkflowFile } from '../../flow/common/workflowFile.ts'
export type { FlowPngAspectRatio, FlowPngLayout } from '../common/png.ts'

export interface FlowPngOptions extends RenderOptions {
  /** Reuses the offline authoring client's Provider metadata and JSON cache. */
  readonly client?: ControlClient
  /** Reuse an instance across exports; defaults to a shared in-memory cache. */
  readonly iconCache?: ProviderIconCache
}

const defaultIconCache = new ProviderIconCache({ scope: 'node-renderer' })

export interface FlowPngResult extends Omit<RenderResponse, 'dataUrl'> {
  readonly buffer: Buffer
}

/** Render a workflow file without launching or closing the caller's browser. */
export async function flowToPng(browser: Browser, workflow: WorkflowFile, options: FlowPngOptions = {}): Promise<FlowPngResult> {
  const file = decodeWorkflowFile(workflow)
  getFlowPngAspectRatio(options.aspectRatio)
  const { client, iconCache = defaultIconCache, ...renderOptions } = options
  let providers: readonly ConnectorProvider[] | undefined
  if (client && (connectionUsage(file.content.document).length > 0 || codeActions(file.content.document).length > 0)) {
    try {
      providers = await client.listConnectorProviders(undefined, undefined, options.language ?? 'en', { cacheOnly: options.allowNetwork === false })
    } catch {
      // Provider metadata is optional; render the bundled fallback icons.
    }
  }
  const packageRoot = dirname(createRequire(import.meta.url).resolve('@oomol-lab/open-flow/package.json'))
  const [script, style] = await Promise.all([
    readFile(join(packageRoot, 'dist/render/browser/runtime.js'), 'utf8'),
    readFile(join(packageRoot, 'dist/render/browser/runtime.css'), 'utf8'),
  ])
  const context = await browser.newContext({ deviceScaleFactor: 1, serviceWorkers: 'block' })
  let failed = false
  try {
    if (options.allowNetwork === false) await context.route('**/*', (route) => route.abort())
    const page = await context.newPage()
    await page.exposeFunction('OpenFlowProviderIcon', (request: ProviderIconRequest) => iconCache.get(request, { allowNetwork: options.allowNetwork }))
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    await page.addStyleTag({ content: style })
    await page.addScriptTag({ content: script })
    const result = await page.evaluate<RenderResponse, string>(
      (serialized) => (globalThis as typeof globalThis & RendererGlobals).OpenFlowRenderer.render(JSON.parse(serialized)),
      JSON.stringify({ workflow: file, options: renderOptions, ...(providers == null ? {} : { providers }) } satisfies RenderRequest),
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
