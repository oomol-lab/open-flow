import '@oomol-lab/open-flow/preview.css'
import type { CanvasDirection, InteractiveMode, UiLanguage } from '@oomol-lab/open-flow/preview'
import type { ReactNode } from 'react'
import type { FrontendStory } from './stories.tsx'

import { OpenFlowPreview } from '@oomol-lab/open-flow/preview'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { previewProviderCatalog, previewProviderFixture } from './previewProviderFixture.ts'
import { publicationFixture } from './publicationFixture.ts'
import { useStoryActions } from './storyActions.tsx'

const fixture = publicationFixture('preview-lab', 'preview-revision')
const providerFixture = previewProviderFixture()

/** Lab-only host for interaction checks; it does not verify the standalone CSS dependency set. */
function ShadowSample({ children }: { readonly children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<ShadowRoot>()
  const [error, setError] = useState<string>()
  useLayoutEffect(() => {
    const shadow = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' })
    let active = true
    const loads: Promise<void>[] = []
    // Clone actual style sources: CSSOM serialization can alter mask URLs and nested rules.
    const styles = [...document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')].map((source) => {
      const clone = source.cloneNode(true) as HTMLStyleElement | HTMLLinkElement
      if (source instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) {
        clone.href = source.href
        loads.push(
          new Promise((resolve, reject) => {
            clone.addEventListener('load', () => resolve(), { once: true })
            clone.addEventListener('error', () => reject(new Error(`Could not load stylesheet: ${clone.href}`)), { once: true })
          }),
        )
      }
      shadow.append(clone)
      return clone
    })
    void Promise.all(loads).then(
      () => {
        if (active) setRoot(shadow)
      },
      (reason: unknown) => {
        if (active) setError(String(reason))
      },
    )
    return () => {
      active = false
      styles.forEach((style) => style.remove())
    }
  }, [])
  if (error) return <p role="alert">{error}</p>
  return (
    <div ref={host} style={{ height: '100%', minHeight: 0 }}>
      {root && createPortal(children, root)}
    </div>
  )
}

function PreviewStory({ dark, language, shadow }: { readonly dark: boolean; readonly language: UiLanguage; readonly shadow: boolean }) {
  const [version, setVersion] = useState(0)
  const [missingLayout, setMissingLayout] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [providerExample, setProviderExample] = useState(false)
  const [defaultInteractiveMode, setDefaultInteractiveMode] = useState<InteractiveMode>()
  const [defaultDirection, setDefaultDirection] = useState<CanvasDirection>()
  const [defaultMiniMapExpanded, setDefaultMiniMapExpanded] = useState(false)
  const [defaultInspectorOpen, setDefaultInspectorOpen] = useState(false)
  const [selectionSample, setSelectionSample] = useState(0)
  const [nodesDraggable, setNodesDraggable] = useState(true)
  const [dottedBackground, setDottedBackground] = useState(true)
  const [layoutMotion, setLayoutMotion] = useState(true)
  const catalog = useMemo(() => previewProviderCatalog(language), [language])
  const [loadedCatalog, setLoadedCatalog] = useState<typeof catalog>()
  const sample = providerExample ? providerFixture : fixture
  const selectionSamples = [
    { label: 'no selection', ids: [] },
    { label: 'selected node', ids: providerExample ? ['mail'] : ['customer'] },
    { label: providerExample ? 'missing selected node' : 'selected comment', ids: ['note'] },
    { label: 'multiple selected nodes', ids: providerExample ? ['mail', 'agent'] : ['start', 'prepare'] },
  ]
  const nextSelectionSample = (selectionSample + 1) % selectionSamples.length
  useStoryActions([
    { label: 'Reset session', onClick: () => setVersion((value) => value + 1) },
    {
      label: defaultInteractiveMode === 'mouse' ? 'Initialize touchpad mode' : 'Initialize mouse mode',
      onClick: () => {
        setDefaultInteractiveMode(defaultInteractiveMode === 'mouse' ? 'touchpad' : 'mouse')
        setVersion((value) => value + 1)
      },
    },
    {
      label: defaultDirection === 'vertical' ? 'Initialize horizontal layout' : 'Initialize vertical layout',
      onClick: () => {
        setDefaultDirection(defaultDirection === 'vertical' ? 'horizontal' : 'vertical')
        setVersion((value) => value + 1)
      },
    },
    {
      label: defaultMiniMapExpanded ? 'Initialize without mini map' : 'Initialize with mini map',
      onClick: () => {
        setDefaultMiniMapExpanded(!defaultMiniMapExpanded)
        setVersion((value) => value + 1)
      },
    },
    {
      label: defaultInspectorOpen ? 'Initialize without inspector' : 'Initialize with inspector',
      onClick: () => {
        setDefaultInspectorOpen(!defaultInspectorOpen)
        setVersion((value) => value + 1)
      },
    },
    {
      label: `Initialize ${selectionSamples[nextSelectionSample]!.label}`,
      onClick: () => {
        setSelectionSample(nextSelectionSample)
        setVersion((value) => value + 1)
      },
    },
    {
      label: 'Change defaults without resetting',
      onClick: () => {
        setDefaultInteractiveMode(defaultInteractiveMode === 'mouse' ? 'touchpad' : 'mouse')
        setDefaultDirection(defaultDirection === 'vertical' ? 'horizontal' : 'vertical')
        setDefaultMiniMapExpanded(!defaultMiniMapExpanded)
        setDefaultInspectorOpen(!defaultInspectorOpen)
        setSelectionSample(nextSelectionSample)
      },
    },
    { label: nodesDraggable ? 'Disable node dragging' : 'Enable node dragging', onClick: () => setNodesDraggable(!nodesDraggable) },
    { label: dottedBackground ? 'Hide grid' : 'Show grid', onClick: () => setDottedBackground(!dottedBackground) },
    { label: layoutMotion ? 'Disable layout motion' : 'Enable layout motion', onClick: () => setLayoutMotion(!layoutMotion) },
    {
      label: missingLayout ? 'Use saved layout' : 'Remove saved layout',
      onClick: () => {
        setMissingLayout(!missingLayout)
        setVersion((value) => value + 1)
      },
    },
    { label: narrow ? 'Wide container' : 'Narrow container', onClick: () => setNarrow(!narrow) },
    {
      label: providerExample ? 'Publication example' : 'Provider example',
      onClick: async () => {
        if (!providerExample) await catalog.cache.clear()
        setProviderExample(!providerExample)
        setVersion((value) => value + 1)
      },
    },
    ...(providerExample
      ? [
          {
            label: 'Load Provider metadata',
            disabled: loadedCatalog === catalog,
            onClick: () => {
              catalog.resolve()
              setLoadedCatalog(catalog)
            },
          },
        ]
      : []),
  ])
  const preview = (
    <OpenFlowPreview
      key={version}
      {...sample}
      presentation={missingLayout ? null : sample.presentation}
      language={language}
      theme={dark ? 'dark' : 'light'}
      defaultInteractiveMode={defaultInteractiveMode}
      defaultDirection={defaultDirection}
      defaultMiniMapExpanded={defaultMiniMapExpanded}
      defaultInspectorOpen={defaultInspectorOpen}
      defaultSelectedNodeIds={selectionSamples[selectionSample]!.ids}
      nodesDraggable={nodesDraggable}
      dottedBackground={dottedBackground}
      layoutMotion={layoutMotion}
    />
  )
  return <div style={{ height: 640, width: narrow ? 420 : '100%', maxWidth: '100%' }}>{shadow ? <ShadowSample>{preview}</ShadowSample> : preview}</div>
}

export const previewStories: readonly FrontendStory[] = [false, true].map((shadow) => ({
  group: 'Workbench',
  id: shadow ? 'preview-shadow' : 'preview',
  title: shadow ? 'Preview · Shadow DOM' : 'Preview',
  standalone: true,
  description:
    'Public preview with no title bar. Initialize interaction mode, direction, mini map, inspector and selection, then change defaults without resetting to confirm the current session stays unchanged. Selection examples cover one node, a comment and multiple nodes; open the inspector to see each selection. Toggle dragging, grid and layout motion during the session. With dragging disabled, nodes remain selectable and inspectable. Switch direction inside the canvas and restore the saved direction and positions. Compare themes, missing layout and narrow containers; missing layout shows no status message. In the Provider example, open Agent Tools: the shared selection dialog shows only saved tools, without the picker or editing actions. Use each settings gear to inspect saved parameters; Escape returns focus to that gear, then to the Tools button. Move or select a node before loading the deterministic catalog; Connector icons and Agent tool badges read the same resource-cache singleton without resetting the session. No workflow API or persistence.',
  render: (_log, dark, language) => <PreviewStory dark={dark} language={language} shadow={shadow} />,
}))
