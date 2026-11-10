import 'virtual:uno.css'
import '../../workbench/browser/runtime/preview.css'
import type { RenderRequest, RenderResponse, RendererGlobals } from '../common/png.ts'

import { flowToPng } from '../../canvas/browser/graph/FlowCanvas/exportPng.ts'
import { createI18n } from '../../workbench/browser/runtime/i18n.ts'
import { designerGraph } from '../../workbench/browser/runtime/workspace.ts'

/** Runs only inside the caller's Chromium, using the same renderer as Workbench. */
export async function render({ workflow, options, providers }: RenderRequest): Promise<RenderResponse> {
  const language = options.language ?? 'en'
  document.documentElement.lang = language
  document.body.className = 'open-flow-theme open-flow-workbench'
  document.body.dataset.theme = options.dark ? 'dark' : 'light'
  const i18n = createI18n(language)
  try {
    const model = designerGraph(
      workflow,
      workflow.presentation,
      [],
      {},
      {},
      i18n.t,
      undefined,
      [],
      Object.fromEntries((providers ?? []).map((provider) => [provider.serviceId, provider])),
    )
    const result = await flowToPng(model, language, {
      layout: options.layout,
      aspectRatio: options.aspectRatio,
      dark: options.dark,
      frame: options.frame,
      title: options.title ?? workflow.name ?? 'Workflow',
      iconCache: { get: (request) => (globalThis as typeof globalThis & RendererGlobals).OpenFlowProviderIcon(request) },
    })
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(reader.result as string), { once: true })
      reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read the workflow image.')), { once: true })
      reader.readAsDataURL(result.blob)
    })
    return { dataUrl, width: result.width, height: result.height, hasImagePlaceholders: result.hasImagePlaceholders }
  } finally {
    i18n.dispose()
  }
}
