import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { ConditionSettings } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { conditionOperands, setConditionInput } from '../../src/flow/common/condition.ts'
import { ConditionBranchesEditor } from '../../src/workbench/browser/runtime/editor/conditionBranchesEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

const initial: ConditionSettings = {
  matchMode: 'first',
  cases: [
    {
      output: 'approved',
      groups: [
        {
          expressions: [
            { left: { kind: 'source', source: { kind: 'node', nodeId: 'order', output: 'total' } }, operator: '>=', right: { kind: 'value', value: 100 } },
            { left: { kind: 'source', source: { kind: 'node', nodeId: 'order', output: 'status' } }, operator: '==', right: { kind: 'value', value: 'paid' } },
          ],
        },
        { expressions: [{ left: { kind: 'source', source: { kind: 'node', nodeId: 'order', output: 'vip' } }, operator: 'isTrue' }] },
      ],
    },
    {
      output: 'manual-review',
      groups: [
        {
          expressions: [
            {
              left: { kind: 'source', source: { kind: 'node', nodeId: 'missing', output: 'status' } },
              operator: '==',
              right: { kind: 'value', value: 'pending' },
            },
          ],
        },
      ],
    },
    {
      output: 'constant-comparison-with-a-long-case-name',
      groups: [{ expressions: [{ left: { kind: 'value', value: 1 }, operator: '>', right: { kind: 'value', value: 0 } }] }],
    },
  ],
}
function ConditionEditorStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [disabled, setDisabled] = useState(false)
  const [value, setValue] = useState(initial)
  const [width, setWidth] = useState(640)
  const save = (next: ConditionSettings) => {
    setValue(next)
    log('Save conditions', next)
  }
  useStoryActions([
    { label: disabled ? 'Editable' : 'Read only', onClick: () => setDisabled(!disabled) },
    { label: width === 640 ? 'Narrow panel' : 'Wide panel', onClick: () => setWidth(width === 640 ? 360 : 640) },
    { label: 'Empty group', onClick: () => setValue({ matchMode: 'first', cases: [{ output: 'incomplete', groups: [] }] }) },
    {
      label: 'Invalid comparison',
      onClick: () =>
        setValue({
          matchMode: 'first',
          cases: [
            {
              output: 'invalid',
              groups: [{ expressions: [{ left: { kind: 'value', value: 0 }, operator: '==', right: { kind: 'value', value: '2' } }] }, { expressions: [] }],
            },
          ],
        }),
    },
    {
      label: 'Collections',
      onClick: () =>
        setValue({
          matchMode: 'first',
          cases: [
            {
              output: 'collections',
              groups: [
                { expressions: [{ left: { kind: 'value', value: { nested: { active: true } } }, operator: '==', right: { kind: 'value', value: [1, 2] } }] },
              ],
            },
          ],
        }),
    },
    { label: 'Reset', onClick: () => setValue(initial) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24 }}>
        <div className="context-panel editor-context-panel open-flow-property-panel" style={{ position: 'relative', width, maxWidth: '100%', height: 'auto' }}>
          <ConditionBranchesEditor
            value={value}
            disabled={disabled}
            onChange={save}
            sourceType={(source) =>
              source.kind !== 'node' ? undefined : source.output === 'total' ? 'number' : source.output === 'vip' ? 'boolean' : 'string'
            }
            renderSource={(handle) => {
              const operand = conditionOperands(value).find((item) => item.handle === handle)?.operand
              const source = operand?.kind === 'source' && operand.source.kind === 'node' ? operand.source : undefined
              return {
                current:
                  source == null
                    ? []
                    : [
                        {
                          ...source,
                          nodeName: source.nodeId === 'order' ? 'Order' : undefined,
                          icon: 'i-lucide-light:package',
                          check: { kind: source.nodeId === 'order' ? 'available' : 'source-missing' },
                        },
                      ],
                groups: [
                  {
                    nodeId: 'order',
                    nodeName: 'Order',
                    icon: 'i-lucide-light:package',
                    outputs: ['total', 'status', 'vip'].map((output) => ({ output, check: { kind: 'available' as const } })),
                  },
                ],
                onChange: (next) => {
                  const node = setConditionInput({ ...value, kind: 'condition', inputs: {} }, handle, { kind: 'sources', sources: [{ kind: 'node', ...next }] })
                  save({ cases: node.cases, matchMode: node.matchMode })
                },
              }
            }}
          />
        </div>
      </div>
    </I18nProvider>
  )
}
export const conditionEditorStory: FrontendStory = {
  group: 'Node Condition',
  id: 'condition-editor',
  title: 'Condition Editor',
  standalone: true,
  description:
    'Expand Cases to inspect AND/OR groups, attached Source and type buttons, operator tooltips and text menus, missing references, and constant comparisons. Use the toolbar for invalid comparisons, empty groups, read-only and narrow layouts.',
  render: (log, dark, language) => <ConditionEditorStory dark={dark} language={language} log={log} />,
}
