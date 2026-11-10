import type { ReactElement } from 'react'
import type { CanvasDirection } from '../../../canvas/common/direction.ts'
import type { InteractiveMode } from '../../../canvas/common/interactiveMode.ts'
import type { ProviderIconLoader } from '../../../connector/common/providerIconCache.ts'
import type { Draft, Presentation } from '../../../control/common/api.ts'
import type { UiLanguage } from '../../../localization/common/languages.ts'

import { useEffect, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { IconifyProvider } from '../../../ui/browser/icons/iconifyContext.tsx'
import { IconThemeContext } from '../../../ui/browser/icons/iconTheme.ts'
import { ProviderIconCacheContext } from '../../../ui/browser/icons/providerIconResource.ts'
import { cn } from '../../../ui/browser/utils.ts'
import { RevisionCanvas } from './editor/revisionCanvas.tsx'
import { createI18n } from './i18n.ts'

export type { Draft, Presentation } from '../../../control/common/api.ts'
export type { UiLanguage } from '../../../localization/common/languages.ts'
export type { InteractiveMode } from '../../../canvas/common/interactiveMode.ts'
export type { CanvasDirection } from '../../../canvas/common/direction.ts'

export interface OpenFlowPreviewProps {
  /** Optional shared Provider artwork cache; defaults to browser IndexedDB. */
  readonly iconCache?: ProviderIconLoader
  readonly draft: Draft
  readonly presentation: Presentation | null
  readonly language: UiLanguage
  readonly theme: 'light' | 'dark'
  /** Initial interaction mode. Defaults to touchpad. Later changes are session-local. */
  readonly defaultInteractiveMode?: InteractiveMode
  /** Initial direction override. A different direction reflows nodes; restoring uses the supplied presentation. */
  readonly defaultDirection?: CanvasDirection
  /** Whether the mini map starts expanded. Defaults to false. */
  readonly defaultMiniMapExpanded?: boolean
  /** Whether the property panel starts open. Defaults to false. */
  readonly defaultInspectorOpen?: boolean
  /** Initial selected node or comment IDs. Missing IDs are ignored. Defaults to no selection. */
  readonly defaultSelectedNodeIds?: readonly string[]
  /** Allows temporary node movement. Defaults to true. */
  readonly nodesDraggable?: boolean
  /** Shows the canvas dot grid. Defaults to true. */
  readonly dottedBackground?: boolean
  /** Animates layout changes, respecting reduced-motion preferences. Defaults to true. */
  readonly layoutMotion?: boolean
  readonly label?: string
  readonly className?: string
}

/** Offline workflow preview. Use a React key to start a new layout/selection session. */
export function OpenFlowPreview({
  iconCache,
  draft,
  presentation,
  language,
  theme,
  defaultInteractiveMode,
  defaultDirection,
  defaultMiniMapExpanded,
  defaultInspectorOpen,
  defaultSelectedNodeIds,
  nodesDraggable = true,
  dottedBackground = true,
  layoutMotion = true,
  label,
  className,
}: OpenFlowPreviewProps): ReactElement {
  const [i18n] = useState(() => createI18n(language))
  useEffect(() => {
    if (i18n.lang !== language) void i18n.switchLang(language)
  }, [i18n, language])
  useEffect(() => () => i18n.dispose(), [i18n])
  return (
    <ProviderIconCacheContext.Provider value={iconCache}>
      <IconThemeContext.Provider value={theme}>
        <IconifyProvider>
          <I18nProvider i18n={i18n}>
            <div className={cn('open-flow-theme open-flow-workbench open-flow-preview', className)} data-theme={theme}>
              <RevisionCanvas
                draft={draft}
                presentation={presentation}
                theme={theme}
                defaultInteractiveMode={defaultInteractiveMode}
                defaultDirection={defaultDirection}
                defaultMiniMapExpanded={defaultMiniMapExpanded}
                defaultInspectorOpen={defaultInspectorOpen}
                defaultSelectedNodeIds={defaultSelectedNodeIds}
                nodesDraggable={nodesDraggable}
                layoutMotion={layoutMotion}
                label={label}
                background={dottedBackground ? 'dotted' : 'none'}
                showHeader={false}
              />
            </div>
          </I18nProvider>
        </IconifyProvider>
      </IconThemeContext.Provider>
    </ProviderIconCacheContext.Provider>
  )
}
