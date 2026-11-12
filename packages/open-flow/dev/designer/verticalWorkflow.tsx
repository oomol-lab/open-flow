import styles from './verticalWorkflow.module.scss'
import type { CanvasDirection, FlowCanvasViewCommentNode, FlowCanvasViewPosition } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { CanvasCommand, CanvasCommandSubscriber } from '../../src/canvas/common/commands.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { ApplicationScenario } from './fixtures/applicationWorkflow.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { applicationWorkflow, applicationPositions, applicationEdges } from './fixtures/applicationWorkflow.ts'
import { coffeeGroupsWorkflow } from './fixtures/coffeeGroupsWorkflow.ts'
import { useStoryActions } from './storyActions.tsx'

function WorkflowCanvas({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const [coffeeGroups, setCoffeeGroups] = useState(false)
  const [scenario, setScenario] = useState<ApplicationScenario>('processing')
  const [showRecords, setShowRecords] = useState(true)
  const [direction, setDirection] = useState<CanvasDirection>('vertical')
  const [positions, setPositions] = useState(applicationPositions)
  const [viewport, setViewport] = useState({ x: 40, y: 30, zoom: 0.6 })
  const [edges, setEdges] = useState(applicationEdges)
  const [removed, setRemoved] = useState<readonly string[]>([])
  const [hidden, setHidden] = useState<Readonly<Record<string, boolean>>>({})
  const [widths, setWidths] = useState<Readonly<Record<string, number | undefined>>>({})
  const [selected, setSelected] = useState<readonly string[]>([])
  const [generation, setGeneration] = useState(0)
  const commands = useMemo(() => {
    const listeners = new Set<(command: CanvasCommand) => void>()
    const subscribe: CanvasCommandSubscriber = (execute) => {
      listeners.add(execute)
      return () => {
        listeners.delete(execute)
      }
    }
    return {
      subscribe,
      send: (command: CanvasCommand) => {
        for (const execute of listeners) execute(command)
      },
    }
  }, [])
  const focus = (nodeId: string) => {
    commands.send({ type: 'zoom', zoom: 1 })
    commands.send({ type: 'focus', nodeId })
  }
  const show = (next: ApplicationScenario, nodeId: string) => {
    setScenario(scenario === next ? 'processing' : next)
    focus(nodeId)
  }
  const reset = (coffee: boolean) => {
    setCoffeeGroups(coffee)
    setScenario('processing')
    setShowRecords(true)
    setDirection('vertical')
    setPositions(coffee ? {} : applicationPositions)
    setEdges(coffee ? [...coffeeGroupsWorkflow.edges] : applicationEdges)
    setRemoved([])
    setHidden({})
    setWidths({})
    setSelected([])
    setGeneration((value) => value + 1)
  }
  useStoryActions([
    {
      label: coffeeGroups ? 'Show applications' : 'Show coffee groups',
      onClick: () => reset(!coffeeGroups),
    },
    { label: 'Overview', onClick: () => commands.send({ type: 'fit' }) },
    ...(coffeeGroups
      ? []
      : [
          { label: 'Branch details', onClick: () => focus('condition') },
          { label: scenario === 'disconnected' ? 'Restore connection' : 'Provider disconnected', onClick: () => show('disconnected', 'regular') },
          { label: scenario === 'failed' ? 'Restore successful run' : 'Run failed', onClick: () => show('failed', 'save') },
          { label: scenario === 'configuration' ? 'Restore configuration' : 'Configuration error', onClick: () => show('configuration', 'condition') },
          { label: 'Compact view', onClick: () => commands.send({ type: 'zoom', zoom: 0.4 }) },
          { label: scenario === 'deferred' ? 'Restore account' : 'Account setup deferred', onClick: () => show('deferred', 'regular') },
          {
            label: scenario === 'review' ? 'Show standard route' : 'Show manual review',
            onClick: () => setScenario(scenario === 'review' ? 'processing' : 'review'),
          },
          { label: showRecords ? 'Hide run records' : 'Show run records', onClick: () => setShowRecords(!showRecords) },
        ]),
    {
      label: 'Reset sample',
      onClick: () => reset(coffeeGroups),
    },
  ])
  const sample = coffeeGroups ? coffeeGroupsWorkflow : applicationWorkflow(scenario, showRecords)
  const note: FlowCanvasViewCommentNode = {
    id: 'comment',
    kind: 'comment',
    title: 'Review notes',
    content: 'Check the score and route before approving an application.',
    position: { x: 780, y: 300 },
  }
  const model = {
    ...sample,
    direction,
    viewport,
    edges: edges.filter((edge) => !removed.includes(edge.source) && !removed.includes(edge.target)),
    nodes: (coffeeGroups ? sample.nodes : [...sample.nodes, note])
      .filter((node) => !removed.includes(node.id))
      .map((node) =>
        Object.assign(
          {},
          node,
          { position: positions[node.id] ?? node.position, contentHidden: hidden[node.id] },
          node.kind === 'condition' ? { verticalWidth: widths[node.id] } : {},
        ),
      ),
  }
  const move = (updates: Readonly<Record<string, FlowCanvasViewPosition>>) => setPositions((current) => ({ ...current, ...updates }))
  return (
    <div className={styles.canvas}>
      <FlowCanvasView
        identity={`application-${generation}`}
        model={model}
        editable
        dark={dark}
        language={language}
        fitView
        autoLayout
        ignoredNodeIds={[]}
        selectedNodeIds={selected}
        onSelectionChange={setSelected}
        subscribeCanvasCommands={commands.subscribe}
        onMoveNodes={move}
        onMoveViewport={setViewport}
        onChangeNodeWidth={(nodeId, width, position) => {
          setWidths((current) => ({ ...current, [nodeId]: width }))
          if (position) move({ [nodeId]: position })
          return true
        }}
        onChangeDirection={(next, updates) => {
          setDirection(next)
          move(updates)
          log('Change layout direction', next)
          return true
        }}
        onConnect={(edge) => {
          setEdges((current) => [...current, { ...edge, id: `${edge.source}-${edge.target}-${current.length}` }])
          log('Connect nodes', edge)
        }}
        onDisconnect={(edge) => setEdges((current) => current.filter((item) => item.id !== edge.id))}
        onDeleteNodes={(ids) => setRemoved((current) => [...current, ...ids])}
        onChangeNodeContentHidden={(id, value) => setHidden((current) => ({ ...current, [id]: value }))}
      />
    </div>
  )
}

export const verticalWorkflowStory: FrontendStory = {
  group: 'Canvas',
  id: 'vertical-workflow',
  title: 'Vertical workflow',
  standalone: true,
  description:
    'Inspect automatic spacing between compact cards, content, branches and comments. Show coffee groups reproduces pagination and two group-processing returns. Check that returns avoid every card, remain distinguishable, and follow dragged or resized nodes. Change direction or re-layout from the canvas view controls; comments participate in both. Compare Provider disconnection, run failure, configuration errors, deferred accounts, manual review and compact status icons. Layout changes stay in this sample.',
  render: (log, dark, language) => <WorkflowCanvas dark={dark} language={language} log={log} />,
}
