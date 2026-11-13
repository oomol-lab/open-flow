import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { defaultDelayDurationMs } from '../../src/flow/common/delay.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { OpenFlowPreview } from '../../src/workbench/browser/runtime/openFlowPreview.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: {
    bindings: {},
    graph: {
      nodes: {
        start: { kind: 'start', name: 'Start', inputDefs: [] },
        pause: { kind: 'delay', name: 'Default duration', durationMs: defaultDelayDurationMs, inputs: {} },
        minute: { kind: 'delay', name: 'One minute', description: 'Allow the service to finish processing.', durationMs: 60_000, inputs: {} },
        schedule: { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', value: 1, unit: 'minute' }] },
        empty: { kind: 'delay', name: 'Empty duration', durationMs: null, inputs: {} },
        invalid: { kind: 'delay', name: 'Invalid duration', durationMs: 0, inputs: {} },
        out: { kind: 'outputs', name: 'Outputs', outputDefs: [], outputMappings: {} },
      },
      edges: [
        { source: 'start', target: 'pause' },
        { source: 'pause', target: 'out' },
      ],
    },
  },
}

function Delay({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
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
      label: 'Undo',
      onClick: () => {
        void session?.store.undo()
      },
    },
    {
      label: 'Redo',
      onClick: () => {
        void session?.store.redo()
      },
    },
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
      <div className="grid gap-5 p-5">
        <div className="h-80">
          <OpenFlowPreview draft={revision.revision} presentation={null} language={language} theme={theme} />
        </div>
        <div className="open-flow-workbench open-flow-theme grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5" data-theme={theme}>
          {['pause', 'minute', 'empty', 'invalid'].map((id) => (
            <section key={id} className="grid h-[600px] min-h-0 grid-rows-[minmax(0,1fr)]">
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
      </div>
    </I18nProvider>
  )
}

export const delayStory: FrontendStory = {
  group: 'Node Delay',
  id: 'delay',
  title: 'Duration and continuation',
  standalone: true,
  description:
    'Compare the five-second default and described duration with Schedule content. Clear a duration to inspect validation; check editing, undo/redo, reload and read-only states.',
  render: (log, dark, language) => <Delay dark={dark} language={language} log={log} />,
}
