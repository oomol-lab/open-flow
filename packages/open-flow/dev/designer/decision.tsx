import type { DecisionQuestion } from '../../src/decision/common/decision.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { decisionLimits, decisionTask } from '../../src/decision/common/decision.ts'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { decodeRevisionContent } from '../../src/flow/common/encoding.ts'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const questions: readonly DecisionQuestion[] = [
  {
    name: 'needs_support',
    type: 'noul',
    instructions: 'Does the customer need support?',
    criteria: { true: 'An issue needs intervention.', false: 'No assistance is needed.' },
  },
  {
    name: 'department',
    type: 'choice',
    instructions: 'Which team should handle this?',
    criteria: [
      { name: 'billing', description: 'Payments and refunds' },
      {
        name: 'technical',
        description: 'Product defects and troubleshooting.\nInclude unexpected behavior, error messages, and steps to reproduce the issue.',
      },
      { name: 'other', description: '' },
    ],
  },
  { name: 'urgency', type: 'score', instructions: 'How urgent is the request?', criteria: ['Not urgent', 'Needs attention', 'Immediate attention'] },
]
const overflowQuestions: readonly DecisionQuestion[] = [
  {
    name: 'categories',
    type: 'choice',
    instructions: 'Choose a category.',
    criteria: Array.from({ length: decisionLimits.choice + 1 }, (_, i) => ({ name: `category${i + 1}`, description: '' })),
  },
  {
    name: 'levels',
    type: 'score',
    instructions: 'Rate urgency.',
    criteria: Array.from({ length: decisionLimits.score + 1 }, (_, i) => `Level ${i}`),
  },
]
function content(sample: string): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      subflows: {},
      tasks: {
        decision: {
          ...decisionTask(
            sample === 'overflow'
              ? overflowQuestions
              : sample === 'invalid'
                ? [
                    { name: 'missing_question', type: 'noul', instructions: '' },
                    { name: 'invalid_choice', type: 'choice', instructions: 'Pick a team.', criteria: [{ name: '', description: '' }] },
                    { name: 'invalid_score', type: 'score', instructions: 'How urgent is it?', criteria: ['Low'] },
                  ]
                : sample === 'none'
                  ? []
                  : sample === 'empty'
                    ? undefined
                    : sample === 'single'
                      ? questions.slice(0, 1)
                      : sample === 'score'
                        ? questions.slice(2)
                        : sample === 'choice'
                          ? questions.slice(1, 2)
                          : questions,
          ),
          ...(sample === 'overflow' ? { executor: { kind: 'decision' as const, questions: overflowQuestions } } : {}),
        },
      },
      graph: {
        nodes: {
          message: {
            kind: 'value',
            name: 'Customer message',
            inputs: {},
            values: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false, value: '付款成功了，但是订单没有生成，请帮我处理。' }],
          },
          decision: {
            kind: 'task',
            taskId: 'decision',
            name: 'AI Decision',
            inputs: { target: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'message', output: 'message' }] } },
          },
        },
        edges: [{ source: 'message', target: 'decision' }],
      },
    },
  }
}
function DecisionStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const [sample, setSample] = useState('single')
  const [disabled, setDisabled] = useState(false)
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), decodeRevisionContent(content(sample)))
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['decision']))
    return () => next.dispose()
  }, [language, sample])
  useStoryActions([
    { label: 'Single question', onClick: () => setSample('single') },
    { label: 'Classification', onClick: () => setSample('choice') },
    { label: 'Scoring', onClick: () => setSample('score') },
    { label: 'All question types', onClick: () => setSample('multiple') },
    { label: 'No questions', onClick: () => setSample('none') },
    { label: 'Unconfigured', onClick: () => setSample('empty') },
    { label: 'Over limits', onClick: () => setSample('overflow') },
    { label: 'Invalid configuration', onClick: () => setSample('invalid') },
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) },
  ])
  return session ? <DecisionPanel session={session} dark={dark} disabled={disabled} /> : null
}
function DecisionPanel({ session, dark, disabled }: { session: ReturnType<typeof createInspectorSession>; dark: boolean; disabled: boolean }) {
  const revision = useVal(session.store.$.revision)
  const selection = revision?.node({ kind: 'flow' }, 'decision')
  return (
    <I18nProvider i18n={session.i18n}>
      <div
        className="open-flow-workbench open-flow-theme"
        data-theme={dark ? 'dark' : 'light'}
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', width: '100%', height: '100%' }}
      >
        {revision && selection && (
          <InspectorSamplePanel disabled={disabled} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'} resizable>
            <NodeInspector
              {...(disabled
                ? { readOnly: true as const }
                : {
                    store: session.store,
                    connectors: session.connectors,
                    triggers: session.triggers,
                    variables: { enabled: true, names: ['MESSAGE'], loaded: true, loading: false, onOpen() {} },
                  })}
              disabled={disabled}
              revision={revision}
              selection={selection}
              target={{ kind: 'flow' }}
              theme={dark ? 'dark' : 'light'}
            />
          </InspectorSamplePanel>
        )}
      </div>
    </I18nProvider>
  )
}
export const decisionStory: FrontendStory = {
  id: 'decision-properties',
  group: 'Node AI Decision',
  title: 'Properties',
  standalone: true,
  description:
    'Edit names and types, insert questions after the current row, or remove them using the row actions; expand questions for their instructions and criteria. Changing a decision type expands its requirements and criteria for editing. Existing valid questions and categories start collapsed, including categories with empty optional descriptions. Invalid and newly added items start expanded. Use Over limits to check that only the first 255 categories and 10 score levels remain, additions are disabled at the limit, and removing an item enables adding again. Question count has no limit. Use Invalid configuration to inspect missing questions, invalid category names, and incomplete score levels. Manual collapse survives subsequent edits and saves. Added categories receive the first available name starting at category1. Score levels show their numeric score and a single-line description input. Verify the input edges align across scores 0–9 in English and Chinese, including empty invalid levels. The shared HelpButton keeps its compact hit area with a 15px info icon. The button beside the levels heading explains scoring on hover, keyboard focus, or click. Clicking keeps the explanation open; Escape and outside interaction dismiss it, and clicking can reopen it without moving the pointer. Add levels to edit them directly; inspect empty levels, fewer than two levels, the ten-level limit, renumbering after deletion, and read-only viewing. With zero or one level, the danger add action below the list shows the count error on hover or keyboard focus and fills the missing levels up to two in one click. Preserve existing descriptions and verify the action disappears at two levels. Question text prompts for decision requirements, while target supplies the data to evaluate; the accessible label is retained. Yes/no criteria sit directly below the question without a gap. Empty yes/no criteria start collapsed; populated criteria start expanded and show a configured count when collapsed. Toggle them and verify drafts survive. Category names align with the question textarea, and their actions align with the question actions. Category descriptions use the same compact preview as multiline inputs. Click a preview to expand and focus its textarea, edit it, and collapse again; verify long multiline text truncates, empty descriptions show the optional hint, and read-only previews still expand. Category names and optional descriptions have placeholders; remove all categories to inspect the add action aligned with both edges of the question textarea, then add one again. With an empty question, focus a category name or description and hover the question: its error stays hidden. Blur the editor to restore hover feedback, and focus an invalid editor to show its own error. Expand all three output types and hover their field names, including nested probabilities and score legend entries; switch languages to verify localized explanations while field identifiers stay unchanged. Inspect all three types, rename outputs, edit categories and ordered levels, bind target, and switch to read-only, an empty question list, or an unconfigured node. Expand Advanced settings and verify the fixed model appears before the common settings, remains selectable, and cannot be edited in either editing or read-only mode. Resize the panel and browser viewport to inspect narrow layouts and consistent 12px textarea typography. Scroll the question name row underneath its sticky title, then hover and focus the question description and nested category descriptions to verify the title stays above the row, and open field feedback and input source menus across section boundaries.',
  render: (log, dark, language) => <DecisionStory log={log} dark={dark} language={language} />,
}
