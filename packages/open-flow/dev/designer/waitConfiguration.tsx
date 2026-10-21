import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: {
    bindings: {},
    graph: {
      edges: [],
      nodes: {
        manual: { kind: 'wait', name: 'Manual continuation', inputs: {}, inputDefinitions: [], prompt: 'Continue when ready.' },
        after: {
          kind: 'wait',
          name: 'After 24 hours',
          inputs: {},
          inputDefinitions: [],
          prompt: 'Review before processing.',
          autoContinue: { kind: 'after', durationMs: 86_400_000 },
        },
        at: {
          kind: 'wait',
          name: 'At a specific time',
          inputs: {},
          inputDefinitions: [],
          prompt: 'Continue at the scheduled time.',
          autoContinue: { kind: 'at', at: '2026-10-25T10:30:00+08:00', timezone: 'Asia/Shanghai' },
        },
        approval: { kind: 'approval', name: 'Manual approval', inputs: {}, inputDefinitions: [], prompt: 'Approve this request?' },
      },
    },
  },
}
function WaitConfiguration({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [disabled, setDisabled] = useState(false)
  const [generation, reset] = useState(0)
  const logger = useRef(log)
  logger.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logger.current(name, value), content)
    setSession(next)
    void next.start()
    return () => next.dispose()
  }, [language, generation])
  const revision = useVal(session?.store.$.revision)
  useStoryActions([
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) },
    {
      label: 'Reload saved data',
      onClick: () => {
        void session?.start()
      },
    },
    { label: 'Reset samples', onClick: () => reset((value) => value + 1) },
  ])
  if (session == null || revision == null) return null
  const theme = dark ? 'dark' : 'light'
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-5 p-5" data-theme={theme}>
        {Object.keys(content.document.graph.nodes).map((id) => (
          <section key={id} className="grid min-h-0 grid-rows-[minmax(0,1fr)]" style={{ height: 900 }}>
            <InspectorSamplePanel disabled={disabled} revision={revision} selection={revision.node(id)} store={session.store} theme={theme}>
              <NodeInspector
                disabled={disabled}
                {...(disabled
                  ? { readOnly: true as const }
                  : {
                      store: session.store,
                      connectors: session.connectors,
                      triggers: session.triggers,
                      variables: { enabled: false, loaded: true, loading: false, names: [], onOpen: undefined },
                    })}
                revision={revision}
                selection={revision.node(id)}
                theme={theme}
              />
            </InspectorSamplePanel>
          </section>
        ))}
      </div>
    </I18nProvider>
  )
}
export const waitConfigurationStory: FrontendStory = {
  group: 'Node Wait',
  id: 'wait-configuration',
  title: 'Automatic continuation',
  standalone: true,
  description:
    'Compare manual, duration and scheduled Waits with manual Approval. Switch modes with an empty value; hover or focus the invalid control to inspect its attached error. Reload saved data to confirm invalid timing stays selected. Edit timing and timezone, then inspect read-only states. Saves use the production editor and store.',
  render: (log, dark, language) => <WaitConfiguration dark={dark} language={language} log={log} />,
}
