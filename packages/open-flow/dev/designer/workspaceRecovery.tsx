import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkspaceRecovery } from '../../src/workbench/browser/runtime/shell/workspaceRecovery.tsx'

function RecoveryStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const states = [
    { kind: 'upgrade' as const },
    { kind: 'repair' as const },
    { kind: 'upgrade' as const, repairing: true },
    { kind: 'repair' as const, message: 'The repair request could not be completed.' },
  ]
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-theme grid min-h-[640px] grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border max-[900px]:grid-cols-1"
        data-theme={dark ? 'dark' : 'light'}
      >
        {states.map((state, index) => (
          <div className="open-flow-workbench min-h-80 bg-background" key={index}>
            <WorkspaceRecovery {...state} onRepair={() => log('repair', state.kind)} onRetry={() => log('retry', state.kind)} />
          </div>
        ))}
      </div>
    </I18nProvider>
  )
}

export const workspaceRecoveryStory: FrontendStory = {
  group: 'Workbench',
  id: 'workspace-recovery',
  title: 'Workspace recovery',
  description: 'Upgrade, damaged, repairing, and failed recovery states remain visible in the workspace instead of using notifications.',
  standalone: true,
  render: (log, dark, language) => <RecoveryStory dark={dark} language={language} log={log} />,
}
