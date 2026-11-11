// @vitest-environment happy-dom
import type { FlowCanvasProps } from '../../../canvas/browser/graph/FlowCanvas/FlowCanvas.tsx'
import type { CanvasStore } from '../../../canvas/browser/stores/canvas/canvas.store.ts'
import type { OpenFlowPreviewProps } from './openFlowPreview.tsx'

import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { previewProviderCatalog } from '../../../../dev/designer/previewProviderFixture.ts'
import { publicationFixture } from '../../../../dev/designer/publicationFixture.ts'
import { click, render } from '../../../../test/support/render.tsx'
import { inputValues } from '../../../flow/common/inputValue.ts'
import { triggerDefinitions } from '../../../trigger/providers/definitions.ts'
import { localizeTrigger } from '../../../trigger/providers/localization.ts'
import { savedPositions, setCanvasLayout } from './canvasPresentation.ts'
import { OpenFlowPreview } from './openFlowPreview.tsx'

const boundary = vi.hoisted(() => ({ props: undefined as FlowCanvasProps | undefined, stores: new Set<CanvasStore>() }))
vi.mock('../../../canvas/browser/graph/FlowCanvas/FlowCanvas.tsx', () => ({
  FlowCanvas: (props: FlowCanvasProps) => {
    boundary.props = props
    boundary.stores.add(props.flowCanvasStore)
    return <>{props.toolbar}</>
  },
}))

afterEach(() => {
  for (const store of boundary.stores) store.dispose()
  boundary.stores.clear()
})

function previewProps(overrides: Partial<OpenFlowPreviewProps> = {}): OpenFlowPreviewProps {
  return { ...publicationFixture('preview', 'revision'), language: 'en', theme: 'light', ...overrides }
}

it('localizes saved Provider fields and switches language without loading editable catalogs or changing the snapshot', async () => {
  previewProviderCatalog('zh-CN').resolve()
  previewProviderCatalog('en').resolve()
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const definition = triggerDefinitions.find((entry) => entry.snapshot.key === 'feishu_app_bot.on_event')!.snapshot
  if (definition.type !== 'integration') throw new Error('Expected an Integration Trigger snapshot.')
  const props = previewProps({ language: 'zh-CN', defaultInspectorOpen: true, defaultSelectedNodeIds: ['trigger'] })
  const draft = {
    ...props.draft,
    content: {
      ...props.draft.content,
      document: {
        ...props.draft.content.document,
        graph: {
          nodes: {
            trigger: {
              name: definition.displayName,
              kind: 'integration' as const,
              definition,
              connectionId: 'saved-account',
              config: inputValues({ sourceId: 'saved-source', eventTypes: ['im.message.receive_v1'] }),
            },
          },
          edges: [],
        },
      },
    },
  }
  const original = structuredClone(draft)
  const view = render(<OpenFlowPreview {...props} draft={draft} />)
  const chinese = await localizeTrigger(definition, 'zh-CN')
  await act(async () => {
    await localizeTrigger(definition, 'zh-CN')
  })
  const names = () => [...view.container.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value)
  expect(names()).toContain(chinese.configInputLabels.sourceId)
  expect(names()).toContain(chinese.configInputLabels.eventTypes)
  view.rerender(<OpenFlowPreview {...props} draft={draft} language="en" />)
  const english = await localizeTrigger(definition, 'en')
  await act(async () => {
    await localizeTrigger(definition, 'en')
  })
  expect(names()).toContain(english.configInputLabels.sourceId)
  expect(names()).not.toContain(chinese.configInputLabels.sourceId)
  expect(draft).toEqual(original)
  expect(request).not.toHaveBeenCalled()
})

function positions(store: CanvasStore) {
  return Object.fromEntries(store.$.rfNodes.value.map((node) => [node.data.store.nodeId, node.position]))
}

function selectedIds(store: CanvasStore) {
  return store.$.rfNodes.value
    .filter((node) => node.selected)
    .map((node) => node.data.store.nodeId)
    .toSorted()
}

async function selectNodes(store: CanvasStore, ids: readonly string[]) {
  await act(async () => {
    const selected = new Set(ids)
    await store.handleNodesChange(store.$.rfNodes.value.map((node) => ({ type: 'select', id: node.id, selected: selected.has(node.data.store.nodeId) })))
    boundary.props!.onSelectionChange?.({ nodes: store.$.rfNodes.value.filter((node) => node.selected), edges: [] })
  })
}

async function completeLayout(store: CanvasStore) {
  let result: ReturnType<CanvasStore['completeLayout']>
  await act(async () => {
    for (const node of [...store.$.nodes.values(), ...store.$.commentNodes!.values()]) {
      node.$$.rfNode.set({ ...node.$.rfNode.value, measured: { width: 420, height: 200 } })
    }
    await Promise.resolve()
    result = store.completeLayout(1000)
  })
  return result!
}

it.each([undefined, 'horizontal', 'vertical'] as const)(
  'keeps saved positions when the default direction is %s or matches the presentation',
  (defaultDirection) => {
    const direction = defaultDirection ?? 'vertical'
    const sample = publicationFixture('preview', 'revision')
    const saved = savedPositions(sample.presentation.value)
    const props = previewProps({
      ...sample,
      presentation: { ...sample.presentation, value: setCanvasLayout(sample.presentation.value, direction, saved) },
      defaultDirection,
    })
    const view = render(<OpenFlowPreview {...props} />)
    const store = boundary.props!.flowCanvasStore

    expect(store.$.direction.value).toBe(direction)
    expect(store.$.interactiveMode.value).toBe('touchpad')
    expect(store.$.miniMapExpanded.value).toBeFalsy()
    expect(selectedIds(store)).toEqual([])
    expect(boundary.props).toMatchObject({ inspectorOpen: false, nodesDraggable: true, dottedBackground: true, layoutMotion: true })
    expect(positions(store)).toEqual(saved)
    expect(store.completeLayout()).toBe(true)
    expect(view.container.textContent).not.toContain('Restore layout')
  },
)

it.each(['horizontal', 'vertical'] as const)(
  'lays out an initial %s override and restores saved direction and positions without changing the viewport',
  async (direction) => {
    const savedDirection = direction === 'horizontal' ? 'vertical' : 'horizontal'
    const sample = publicationFixture('preview', 'revision')
    const saved = savedPositions(sample.presentation.value)
    const props = previewProps({
      ...sample,
      presentation: { ...sample.presentation, value: setCanvasLayout(sample.presentation.value, savedDirection, saved) },
      defaultInteractiveMode: 'mouse',
      defaultDirection: direction,
    })
    const original = structuredClone(props)
    const view = render(<OpenFlowPreview {...props} />)
    const store = boundary.props!.flowCanvasStore

    expect(store.$.direction.value).toBe(direction)
    expect(store.$.changingDirection.value).toBe(true)
    expect(store.$.interactiveMode.value).toBe('mouse')
    expect(await completeLayout(store)).toBe('relayout')
    expect(store.$.changingDirection.value).toBe(false)
    expect(positions(store)).not.toEqual(saved)
    expect(positions(store).note).not.toEqual(saved.note)

    const viewport = { x: 20, y: 30, zoom: 0.7 }
    await act(async () => {
      boundary.props!.onMove?.(null, viewport)
      boundary.props!.onMoveEnd?.(null, viewport)
    })
    const restore = [...view.container.querySelectorAll('button')].find((button) => button.textContent === 'Restore layout')!
    expect(restore).toBeDefined()
    await click(restore)

    expect(store.$.direction.value).toBe(savedDirection)
    expect(positions(store)).toEqual(saved)
    expect(store.$.viewport.value).toEqual(viewport)
    expect(store.$.interactiveMode.value).toBe('mouse')
    expect(view.container.textContent).not.toContain('Restore layout')
    expect(props).toEqual(original)
  },
)

it('keeps session choices when default props change and applies new defaults after a key reset', async () => {
  const props = previewProps({ defaultInteractiveMode: 'mouse', defaultDirection: 'vertical' })
  const view = render(<OpenFlowPreview {...props} />)
  const store = boundary.props!.flowCanvasStore
  await completeLayout(store)

  view.rerender(<OpenFlowPreview {...props} defaultInteractiveMode="touchpad" defaultDirection="horizontal" theme="dark" language="zh-CN" />)
  expect(boundary.props!.flowCanvasStore).toBe(store)
  expect(store.$.interactiveMode.value).toBe('mouse')
  expect(store.$.direction.value).toBe('vertical')

  await act(async () => {
    store.$$.interactiveMode.set('touchpad')
    store.changeDirection('horizontal')
  })
  await completeLayout(store)
  const moved = positions(store)
  view.rerender(<OpenFlowPreview {...props} />)
  expect(store.$.interactiveMode.value).toBe('touchpad')
  expect(store.$.direction.value).toBe('horizontal')
  expect(positions(store)).toEqual(moved)

  view.rerender(<OpenFlowPreview {...props} nodesDraggable={false} dottedBackground={false} layoutMotion={false} />)
  expect(boundary.props).toMatchObject({ nodesDraggable: false, dottedBackground: false, layoutMotion: false })
  expect(boundary.props!.flowCanvasStore).toBe(store)
  expect(positions(store)).toEqual(moved)
  expect(store.$.interactiveMode.value).toBe('touchpad')
  view.rerender(<OpenFlowPreview {...props} />)
  expect(boundary.props).toMatchObject({ nodesDraggable: true, dottedBackground: true, layoutMotion: true })
  expect(positions(store)).toEqual(moved)

  view.rerender(<OpenFlowPreview key="next" {...props} />)
  const next = boundary.props!.flowCanvasStore
  expect(next).not.toBe(store)
  expect(next.$.interactiveMode.value).toBe('mouse')
  expect(next.$.direction.value).toBe('vertical')
  expect(await completeLayout(next)).toBe('relayout')
})

it('supports an initial direction without a saved presentation', async () => {
  render(<OpenFlowPreview {...previewProps({ presentation: null, defaultDirection: 'vertical' })} />)
  const store = boundary.props!.flowCanvasStore
  expect(store.$.direction.value).toBe('vertical')
  expect(await completeLayout(store)).toBe('relayout')
  expect(store.$.direction.value).toBe('vertical')
  expect(store.$.changingDirection.value).toBe(false)
})

it.each([
  { direction: 'horizontal', value: null },
  { direction: 'horizontal', value: {} },
  { direction: 'vertical', value: setCanvasLayout({}, 'vertical') },
  { direction: 'vertical', value: null, defaultDirection: 'vertical' },
] as const)(
  'measures missing coordinates on opening and restores the generated $direction layout (presentation=$value)',
  async ({ direction, value, ...defaults }) => {
    const sample = publicationFixture('preview', 'revision')
    const props = previewProps({
      ...sample,
      ...defaults,
      presentation: value == null ? null : { ...sample.presentation, value },
    })
    const original = structuredClone(props)
    const view = render(<OpenFlowPreview {...props} />)
    const store = boundary.props!.flowCanvasStore
    const estimates = positions(store)
    expect(await completeLayout(store)).toBe('relayout')
    const arranged = positions(store)
    expect(store.$.direction.value).toBe(direction)
    expect(arranged).not.toEqual(estimates)
    expect(view.container.textContent).not.toContain('Restore layout')

    await act(async () => store.onRelayout(1000))
    expect(positions(store)).toEqual(arranged)
    expect(view.container.textContent).not.toContain('Restore layout')

    await act(async () => store.changeDirection(direction === 'horizontal' ? 'vertical' : 'horizontal'))
    expect(await completeLayout(store)).toBe('relayout')
    expect(view.container.textContent).toContain('Restore layout')
    const restore = [...view.container.querySelectorAll('button')].find((button) => button.textContent === 'Restore layout')!
    await click(restore)
    expect(positions(store)).toEqual(arranged)
    expect(store.$.direction.value).toBe(direction)
    expect(view.container.textContent).not.toContain('Restore layout')
    expect(props).toEqual(original)
  },
)

it('preserves partial layouts including a saved origin instead of rearranging existing coordinates', () => {
  const sample = publicationFixture('preview', 'revision')
  const value = setCanvasLayout({}, 'vertical', { prepare: { x: 0, y: 0 } })
  render(<OpenFlowPreview {...previewProps({ ...sample, presentation: { ...sample.presentation, value } })} />)
  const store = boundary.props!.flowCanvasStore
  expect(store.completeLayout()).toBe(true)
  expect(positions(store).prepare).toEqual({ x: 0, y: 0 })
})

it('initializes mini map and inspector once, preserves user toggles and applies defaults again after a key reset', async () => {
  const props = previewProps({ defaultMiniMapExpanded: true, defaultInspectorOpen: true })
  const view = render(<OpenFlowPreview {...props} />)
  const store = boundary.props!.flowCanvasStore
  expect(store.$.miniMapExpanded.value).toBe(true)
  expect(boundary.props!.inspectorOpen).toBe(true)
  expect(view.container.querySelector('[role="dialog"], [role="complementary"]')).not.toBeNull()

  view.rerender(<OpenFlowPreview {...props} defaultMiniMapExpanded={false} defaultInspectorOpen={false} />)
  expect(store.$.miniMapExpanded.value).toBe(true)
  expect(boundary.props!.inspectorOpen).toBe(true)

  await act(async () => store.$$.miniMapExpanded.set(false))
  await click(view.container.querySelector<HTMLButtonElement>('button[aria-label="Close context panel"]')!)
  view.rerender(<OpenFlowPreview {...props} />)
  expect(store.$.miniMapExpanded.value).toBe(false)
  expect(boundary.props!.inspectorOpen).toBe(false)
  expect(view.container.querySelector('[role="dialog"], [role="complementary"]')).toBeNull()

  await act(async () => boundary.props!.onInspectSelection?.())
  expect(boundary.props!.inspectorOpen).toBe(true)
  await click(view.container.querySelector<HTMLButtonElement>('button[aria-label="Close context panel"]')!)

  view.rerender(<OpenFlowPreview key="next" {...props} />)
  expect(boundary.props!.flowCanvasStore).not.toBe(store)
  expect(boundary.props!.flowCanvasStore.$.miniMapExpanded.value).toBe(true)
  expect(boundary.props!.inspectorOpen).toBe(true)
})

it.each([
  { ids: [], title: 'Node outline' },
  { ids: ['customer'], title: 'Customer details' },
  { ids: ['note'], title: 'Release notes' },
  { ids: ['start', 'prepare'], title: '2 nodes selected' },
])('initializes selected IDs $ids with the matching inspector', ({ ids, title }) => {
  const view = render(<OpenFlowPreview {...previewProps({ defaultSelectedNodeIds: ids, defaultInspectorOpen: true })} />)
  expect(selectedIds(boundary.props!.flowCanvasStore)).toEqual(ids.toSorted())
  const panel = view.container.querySelector('[role="dialog"], [role="complementary"]')!
  expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe(title)
  if (ids.length > 1) {
    expect(panel.textContent).toContain('Start onboarding')
    expect(panel.textContent).toContain('Prepare message')
    expect(panel.textContent).not.toContain('Customer details')
    expect(panel.textContent).not.toContain('Release notes')
  }
})

it('uses the canvas title and custom icon in the inspector and updates them with selection without changing the snapshot', async () => {
  const sample = previewProps({ defaultSelectedNodeIds: ['prepare'], defaultInspectorOpen: true })
  const graph = sample.draft.content.document.graph
  const prepare = graph.nodes.prepare!
  if (prepare.kind !== 'task') throw new Error('Expected a Task node.')
  const icon = 'https://example.com/prepare.svg'
  const props = {
    ...sample,
    draft: {
      ...sample.draft,
      content: {
        ...sample.draft.content,
        document: {
          ...sample.draft.content.document,
          graph: { ...graph, nodes: { ...graph.nodes, prepare: { ...prepare, name: undefined, icon } } },
        },
      },
    },
  }
  const original = structuredClone(props)
  const view = render(<OpenFlowPreview {...props} />)
  const panel = view.container.querySelector('[role="dialog"], [role="complementary"]')!
  const title = () => document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent
  const headerIcon = () => panel.querySelector('header img')?.getAttribute('src')

  expect(title()).toBe('Prepare message')
  expect(headerIcon()).toBe(icon)

  await selectNodes(boundary.props!.flowCanvasStore, ['customer'])
  expect(title()).toBe('Customer details')
  expect(headerIcon()).toBeUndefined()
  expect(props).toEqual(original)
})

it('ignores missing and duplicate initial selection IDs without mutating the input', () => {
  const ids = Object.freeze(['missing', 'customer', 'customer'])
  const view = render(<OpenFlowPreview {...previewProps({ defaultSelectedNodeIds: ids, defaultInspectorOpen: true })} />)
  expect(selectedIds(boundary.props!.flowCanvasStore)).toEqual(['customer'])
  expect(view.container.querySelector('[role="dialog"], [role="complementary"]')!.textContent).toContain('Customer details')
  expect(ids).toEqual(['missing', 'customer', 'customer'])
})

it('keeps user selection across default and canvas flag changes and reapplies defaults after a key reset', async () => {
  const props = previewProps({ defaultSelectedNodeIds: ['start'] })
  const view = render(<OpenFlowPreview {...props} />)
  const store = boundary.props!.flowCanvasStore
  view.rerender(<OpenFlowPreview {...props} defaultSelectedNodeIds={['note']} />)
  expect(selectedIds(store)).toEqual(['start'])

  await selectNodes(store, ['customer'])
  view.rerender(<OpenFlowPreview {...props} nodesDraggable={false} dottedBackground={false} layoutMotion={false} />)
  expect(boundary.props!.flowCanvasStore).toBe(store)
  expect(selectedIds(store)).toEqual(['customer'])

  view.rerender(<OpenFlowPreview key="next" {...props} defaultSelectedNodeIds={['note']} />)
  expect(boundary.props!.flowCanvasStore).not.toBe(store)
  expect(selectedIds(boundary.props!.flowCanvasStore)).toEqual(['note'])
})
