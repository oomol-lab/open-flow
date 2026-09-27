import type { ReactElement } from 'react'
import type { Draft, Presentation } from '../../../control/common/api.ts'
import type { UiLanguage } from '../../../localization/common/languages.ts'

import { useEffect, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { IconifyProvider } from '../../../ui/browser/icons/iconifyContext.tsx'
import { IconThemeContext } from '../../../ui/browser/icons/iconTheme.ts'
import { cn } from '../../../ui/browser/utils.ts'
import { RevisionCanvas } from './editor/revisionCanvas.tsx'
import { createI18n } from './i18n.ts'

export type { Draft, Presentation } from '../../../control/common/api.ts'
export type { UiLanguage } from '../../../localization/common/languages.ts'

export interface OpenFlowPreviewProps {
  readonly draft: Draft
  readonly presentation: Presentation | null
  readonly language: UiLanguage
  readonly theme: 'light' | 'dark'
  readonly label?: string
  readonly className?: string
}

/** Offline publication preview. Use a React key to start a new layout/selection session. */
export function OpenFlowPreview({ draft, presentation, language, theme, label, className }: OpenFlowPreviewProps): ReactElement {
  const [i18n] = useState(() => createI18n(language))
  useEffect(() => {
    if (i18n.lang !== language) void i18n.switchLang(language)
  }, [i18n, language])
  useEffect(() => () => i18n.dispose(), [i18n])
  return (
    <IconThemeContext.Provider value={theme}>
      <IconifyProvider>
        <I18nProvider i18n={i18n}>
          <div className={cn('open-flow-theme open-flow-workbench open-flow-preview', className)} data-theme={theme}>
            <RevisionCanvas draft={draft} presentation={presentation} theme={theme} label={label} striped={false} showHeader={false} />
          </div>
        </I18nProvider>
      </IconifyProvider>
    </IconThemeContext.Provider>
  )
}
