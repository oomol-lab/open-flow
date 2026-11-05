import type { WorkflowFile } from '../../flow/common/workflowFile.ts'
import type { UiLanguage } from '../../localization/common/languages.ts'

export interface FlowPngOptions {
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
