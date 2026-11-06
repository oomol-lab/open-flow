import type { WorkflowFile } from '../../flow/common/workflowFile.ts'
import type { UiLanguage } from '../../localization/common/languages.ts'

export type FlowPngLayout = 'original' | 'compact'

export const flowPngAspectRatios = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'] as const
export type FlowPngAspectRatio = (typeof flowPngAspectRatios)[number]

export function getFlowPngAspectRatio(value?: FlowPngAspectRatio): readonly [number, number] | undefined {
  if (value == null || value === 'auto') return undefined
  if (!flowPngAspectRatios.includes(value)) throw new TypeError('Unsupported PNG canvas aspect ratio.')
  const [width, height] = value.split(':').map(Number)
  return [width!, height!]
}

export interface FlowPngOptions {
  /** Compact applies to vertical workflows; horizontal exports preserve saved positions. */
  readonly layout?: FlowPngLayout
  /** Ratio of the complete image, including its frame; defaults to the content bounds. */
  readonly aspectRatio?: FlowPngAspectRatio
  readonly language?: UiLanguage
  readonly dark?: boolean
  readonly frame?: boolean
  readonly title?: string
  /** Allow remote resources by default. Set false when rendering untrusted workflows. */
  readonly allowNetwork?: boolean
}

/** Private, serializable bridge between Node and the bundled browser renderer. */
export interface RenderRequest {
  readonly workflow: WorkflowFile
  readonly options: FlowPngOptions
}

export interface RenderResponse {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
  readonly hasImagePlaceholders: boolean
}

export interface BrowserRenderer {
  render(request: RenderRequest): Promise<RenderResponse>
}
