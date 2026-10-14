import type { ConnectorAction } from '../../src/control/common/api.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const input = { jsonSchema: { type: 'string' } as const, nullable: false }
const action: ConnectorAction = {
  actionId: 'leina.send_notification',
  authenticated: false,
  description: 'Send a notification through a Leina robot’s Home channels.',
  inputs: { leinaId: input, message: { jsonSchema: { type: 'string', minLength: 1, pattern: '\\S' }, nullable: false } },
  outputs: { status: input, requestId: input, leinaId: input },
  name: 'Send notification',
  serviceId: 'leina',
  serviceName: 'Leina',
}
const robot = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: {
    bindings: {},
    graph: {
      edges: [],
      nodes: {
        review: { kind: 'approval', name: 'Review', prompt: 'Publish the report?', inputs: {}, inputDefinitions: [] },
        notify: {
          kind: 'task',
          name: 'Leina notification',
          inputs: { leinaId: { kind: 'value', value: robot }, message: { kind: 'value', value: 'The report is ready.' } },
          task: {
            name: 'Leina notification',
            executor: { kind: 'connector', action: action.actionId },
            inputs: Object.entries(action.inputs).map(([handle, definition]) => ({ handle, jsonSchema: definition.jsonSchema, nullable: definition.nullable })),
            outputs: Object.entries(action.outputs).map(([handle, definition]) => ({
              handle,
              jsonSchema: definition.jsonSchema,
              nullable: definition.nullable,
            })),
          },
        },
      },
    },
  },
}

function Gallery({ language, dark, log }: { language: UiLanguage; dark: boolean; log: LogAction }) {
  const [mode, setMode] = useState<'normal' | 'empty' | 'error' | 'missing' | 'loading' | 'refresh-error'>('normal')
  const [disabled, setDisabled] = useState(false)
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  useEffect(() => {
    let requests = 0
    const next = createInspectorSession(language, log, content, {
      actions: [action],
      providers: [{ authTypes: ['no_auth'], service: 'leina', displayName: 'Leina' }],
      leinaBots: async (signal) => {
        requests += 1
        if (mode == 'loading') await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
        if (mode == 'error' || (mode == 'refresh-error' && requests > 1)) throw new Error('Unavailable')
        return {
          bots:
            mode == 'empty'
              ? []
              : [
                  ...(mode == 'missing' ? [] : [{ leinaId: robot, name: '订单助手', status: 'ready', platforms: ['feishu'] }]),
                  { leinaId: 'default', name: '团队通知助手（用于每日报告与订单处理结果通知）', status: 'unknown', platforms: [] },
                ],
        }
      },
    })
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['notify']))
    return () => next.dispose()
  }, [mode, log])
  useEffect(() => {
    void session?.i18n.switchLang(language)
  }, [session, language])
  const revision = useVal(session?.store.$.revision)
  const selection = useVal(session?.store.$.selection)
  useStoryActions([
    ...(['normal', 'empty', 'error', 'missing', 'loading', 'refresh-error'] as const).map((value) => ({ label: value, onClick: () => setMode(value) })),
    {
      label: 'Connect approval to empty message',
      onClick: async () => {
        if (session == null) return
        await session.store.disconnect({ id: 'preview', source: 'review', target: 'notify', sourceHandle: '$branch:pending', targetHandle: '' })
        await session.store.setInputValue('notify', 'message', undefined)
        await session.store.connect({ source: 'review', target: 'notify', sourceHandle: '$branch:pending', targetHandle: '' })
      },
    },
    { label: 'Clear robot', onClick: () => void session?.store.setInputValue('notify', 'leinaId', undefined) },
    { label: disabled ? 'Enable editing' : 'Disable editing', onClick: () => setDisabled(!disabled) },
    {
      label: 'Reload saved data',
      onClick: () => {
        void session?.start().then(() => session.store.selectNodes(['notify']))
      },
    },
  ])
  if (session == null || revision == null) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme h-[700px]" data-theme={dark ? 'dark' : 'light'}>
        <div className="h-full w-[420px]">
          <InspectorSamplePanel revision={revision} selection={selection} store={session.store} disabled={disabled} theme={dark ? 'dark' : 'light'}>
            <NodeInspector
              revision={revision}
              selection={selection}
              store={session.store}
              connectors={session.connectors}
              triggers={session.triggers}
              connectorAction={action}
              disabled={disabled}
              theme={dark ? 'dark' : 'light'}
              variables={{ enabled: false, names: [], loaded: true, loading: false }}
            />
          </InspectorSamplePanel>
        </div>
      </div>
    </I18nProvider>
  )
}

export const leinaStory: FrontendStory = {
  group: 'Node Task',
  id: 'leina-notification',
  title: 'Leina notification',
  standalone: true,
  description:
    'Clear the robot to inspect required-field feedback. Choose a robot and reload saved data to verify the saved identifier. Use refresh-error and reopen the list to verify the last loaded name survives a failed refresh. Switch response states to inspect loading, empty, failed and missing selections. Use Connect approval to empty message to verify automatic pending.message binding. Message and robot inputs retain their source selectors. Opening the list refreshes robots without changing the saved value.',
  render: (log, dark, language) => <Gallery log={log} dark={dark} language={language} />,
}
