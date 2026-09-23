import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Empty, EmptyHeader, EmptyTitle } from '../../src/ui/browser/empty.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkspaceNavigationIsland } from '../../src/workbench/browser/runtime/shell/workspaceNavigationIsland.tsx'
import { WorkspaceRecovery } from '../../src/workbench/browser/runtime/shell/workspaceRecovery.tsx'

function RecoveryStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const states = [
    { kind: 'upgrade' as const },
    { kind: 'repair' as const },
    { kind: 'upgrade' as const, repairing: true },
    { kind: 'repair' as const, message: 'The repair request could not be completed.' },
    { kind: 'failed' as const },
    { kind: 'loading' as const },
  ]
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-theme grid min-h-[640px] grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border max-[900px]:grid-cols-1"
        data-theme={dark ? 'dark' : 'light'}
      >
        {states.map((state, index) => (
          <div className="open-flow-workbench h-80 bg-background" key={index}>
            <div className="workspace">
              <WorkspaceNavigationIsland flowName="baba" flowsHref="#workflows" ghost onOpenFlows={() => log('flows.open')} />
              {state.kind == 'loading' ? (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyTitle>Loading…</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : (
                <WorkspaceRecovery {...state} onRepair={() => log('repair', state.kind)} onRetry={() => log('retry', state.kind)} />
              )}
            </div>
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
  description: 'The ghost navigation stays visible during loading and above upgrade, repair, repairing, and failed recovery states.',
  standalone: true,
  render: (log, dark, language) => <RecoveryStory dark={dark} language={language} log={log} />,
}
