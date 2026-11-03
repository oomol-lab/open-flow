import styles from './verticalWorkflow.module.scss'
import type { CanvasDirection, FlowCanvasViewModel } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory } from './stories.tsx'

import { useState } from 'react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { applicationWorkflow } from './fixtures/applicationWorkflow.ts'
import { useStoryActions } from './storyActions.tsx'

function conditionSamples(): FlowCanvasViewModel {
  const workflow = applicationWorkflow()
  const condition = workflow.nodes.find((node) => node.kind === 'condition')!
  const score = workflow.nodes.find((node) => node.id === 'score')!
  return {
    direction: 'vertical',
    viewport: { x: 40, y: 40, zoom: 0.9 },
    edges: [],
    nodes: [
      { ...score, position: { x: 0, y: 0 } },
      { ...condition, position: { x: 400, y: 0 } },
      { ...condition, id: 'idle', title: 'Not started', run: undefined, position: { x: 0, y: 250 } },
      { ...condition, id: 'running', title: 'Evaluating rules', run: { status: 'running' }, position: { x: 400, y: 250 } },
      {
        ...condition,
        id: 'failed',
        title: 'Failed evaluation',
        run: {
          status: 'error',
          error: { message: 'score is not a number' },
          logs: [{ level: 'error', time: '2026-11-03T02:00:00.000Z', message: 'Could not evaluate score.' }],
        },
        position: { x: 0, y: 500 },
      },
      { ...condition, id: 'long', title: 'Route by customer score and historical order value', position: { x: 400, y: 500 } },
      {
        ...condition,
        id: 'many',
        title: 'Seven branches',
        run: undefined,
        diagnostics: 1,
        position: { x: 0, y: 750 },
        cases: Array.from({ length: 6 }, (_, index) => ({
          output: `case_${index + 1}`,
          description: index === 0 ? 'Needs manual review' : undefined,
          groups: [],
        })),
        outputs: [...Array.from({ length: 6 }, (_, index) => `case_${index + 1}`), 'otherwise'].map((handle) => ({ handle })),
      },
      {
        ...condition,
        id: 'operands',
        title: 'Long condition values',
        run: undefined,
        position: { x: 0, y: 1000 },
        cases: [
          { output: 'short', groups: [{ expressions: [{ left: '"active"', operator: '==', right: '"ready"' }] }] },
          {
            output: 'long',
            groups: [{ expressions: [{ left: '"international-customer"', operator: '==', right: '"priority-account"' }] }],
          },
          {
            output: 'spaces',
            groups: [{ expressions: [{ left: '"customer name with spaces"', operator: '==', right: '"verified account owner"' }] }],
          },
          { output: 'uneven', groups: [{ expressions: [{ left: '"trial"', operator: '==', right: '"enterprise-account"' }] }] },
          {
            output: 'environment',
            groups: [{ expressions: [{ left: { kind: 'environment', label: 'Environment value' }, operator: '==', right: '"production-account"' }] }],
          },
          { output: 'unary', groups: [{ expressions: [{ left: 'customer.subscription.status', operator: 'is not null' }] }] },
        ],
        outputs: ['short', 'long', 'spaces', 'uneven', 'environment', 'unary', 'otherwise'].map((handle) => ({ handle })),
      },
    ],
  }
}

function ConditionVerticalStory({ dark, language }: { readonly dark: boolean; readonly language: UiLanguage }) {
  const [model, setModel] = useState(conditionSamples)
  const [selected, setSelected] = useState<readonly string[]>(['condition'])
  const [showRecords, setShowRecords] = useState(true)
  const focus = (id: string) => {
    const node = model.nodes.find((candidate) => candidate.id === id)!
    setSelected([id])
    setModel({ ...model, viewport: { x: 40 - node.position.x, y: 40 - node.position.y, zoom: 1 } })
  }
  useStoryActions([
    { label: showRecords ? 'Hide run records' : 'Show run records', onClick: () => setShowRecords(!showRecords) },
    { label: 'Seven branches', onClick: () => focus('many') },
    { label: 'Long operands', onClick: () => focus('operands') },
  ])
  const changeDirection = (direction: CanvasDirection, positions: Readonly<Record<string, { x: number; y: number }>>) => {
    setModel((current) => ({
      ...current,
      direction,
      nodes: current.nodes.map((node) => Object.assign({}, node, { position: positions[node.id] ?? node.position })),
    }))
    return true
  }
  return (
    <div className={styles.canvas}>
      <FlowCanvasView
        identity="condition-directions"
        model={{ ...model, nodes: model.nodes.map((node) => Object.assign({}, node, { run: showRecords && node.kind !== 'comment' ? node.run : undefined })) }}
        dark={dark}
        language={language}
        editable
        fitView
        ignoredNodeIds={[]}
        selectedNodeIds={selected}
        onSelectionChange={setSelected}
        onChangeDirection={changeDirection}
        onChangeNodeWidth={(nodeId, verticalWidth, position) => {
          setModel((current) => ({
            ...current,
            nodes: current.nodes.map((node) =>
              node.id === nodeId && node.kind === 'condition' ? { ...node, verticalWidth, position: position ?? node.position } : node,
            ),
          }))
          return true
        }}
        onMoveNodes={(positions) =>
          setModel((current) => ({
            ...current,
            nodes: current.nodes.map((node) => Object.assign({}, node, { position: positions[node.id] ?? node.position })),
          }))
        }
        onMoveViewport={(viewport) => setModel((current) => ({ ...current, viewport }))}
      />
    </div>
  )
}

export const conditionVerticalStory: FrontendStory = {
  group: 'Node Condition',
  id: 'condition-vertical-layout',
  title: 'Layout directions',
  standalone: true,
  description:
    'Production Condition nodes with both layout directions, run records, selected ports, long titles, long operands and seven branches. Use the canvas direction control to compare layouts.',
  render: (_log, dark, language) => <ConditionVerticalStory dark={dark} language={language} />,
}
