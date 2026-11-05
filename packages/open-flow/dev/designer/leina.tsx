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
const messageSchema = { type: 'string', minLength: 1, pattern: '\\S' } as const
const subscriptionSchema = {
  ...messageSchema,
  description: 'Use the subscription returned by the robot to send to its fixed conversation. Leave unset to use Home.',
}
const action: ConnectorAction = {
  actionId: 'leina.send_notification',
  authenticated: false,
  description: 'Send to the subscribed conversation when a notification subscription is supplied; otherwise use the robot’s Home channels.',
  inputSchema: {
    type: 'object',
    required: ['leinaId', 'message'],
    properties: {
      leinaId: input.jsonSchema,
      message: messageSchema,
      subscription: subscriptionSchema,
    },
  },
  outputSchema: {
    type: 'object',
    required: ['status', 'requestId', 'leinaId'],
    properties: { status: input.jsonSchema, requestId: input.jsonSchema, leinaId: input.jsonSchema },
  },
  inputs: {
    leinaId: input,
    message: { jsonSchema: messageSchema, nullable: false },
    subscription: {
      description: subscriptionSchema.description,
      jsonSchema: subscriptionSchema,
      nullable: true,
      value: null,
    },
  },
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
          inputs: {
            leinaId: { kind: 'value', value: robot },
            message: { kind: 'value', value: 'The report is ready.' },
            subscription: { kind: 'value', value: 'sub_example_conversation' },
          },
          task: {
            name: 'Leina notification',
            executor: { kind: 'connector', action: action.actionId },
            inputs: Object.entries(action.inputs).map(([handle, definition]) => ({
              handle,
              jsonSchema: definition.jsonSchema,
              nullable: definition.nullable,
              description: definition.description,
              value: definition.value,
            })),
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
        await session.store.nodes.setInputValue('notify', 'message', undefined)
        await session.store.connect({ source: 'review', target: 'notify', sourceHandle: '$branch:pending', targetHandle: '' })
      },
    },
    { label: 'Clear robot', onClick: () => void session?.store.nodes.setInputValue('notify', 'leinaId', undefined) },
    { label: 'Use Home', onClick: () => void session?.store.nodes.setInputValue('notify', 'subscription', undefined) },
    { label: 'Use subscription', onClick: () => void session?.store.nodes.setInputValue('notify', 'subscription', 'sub_example_conversation') },
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
    'Expand optional inputs to edit the notification subscription. Use Home clears it; Use subscription restores a fixed conversation. Reload saved data to check persistence. Robot selection and message sources remain independent. Clear robot checks required-field feedback; response states cover loading, empty, failed and missing selections. Connect approval to empty message checks automatic pending.message binding.',
  render: (log, dark, language) => <Gallery log={log} dark={dark} language={language} />,
}
