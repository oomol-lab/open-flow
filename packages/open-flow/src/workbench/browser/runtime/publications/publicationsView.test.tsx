import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { PublicationsView } from './publicationsView.tsx'

vi.mock('./publicationSnapshot.tsx', () => ({
  PublicationSnapshot: ({ publication }: { publication: { revisionId: string } }) => (
    <section aria-label="Publication snapshot">{publication.revisionId}</section>
  ),
}))

function renderState({ failedLoad = false, published = false, loading = false, initial = false, restored = false } = {}) {
  const publication = {
    publicationId: 'publication-current',
    revisionId: 'revision-published',
    createdAt: '2026-09-24T09:00:00.000Z',
    actorId: 'operator',
    operation: restored ? 'rollback' : 'publish',
    sourcePublicationId: restored ? 'publication-source' : undefined,
    liveEnd: { enabled: false, endedAt: '2026-09-25T09:00:00.000Z' },
  }
  const store = {
    $: { busy: val(undefined), diagnostics: val(undefined) },
    workspace: {
      $: {
        flowId: val('flow'),
        flow: val({ flowId: 'flow', name: 'Customer onboarding', status: 'active' }),
        draft: val({ revisionId: 'revision-draft' }),
        presentation: val({ revision: 1, value: {}, version: 1 }),
        revision: val(undefined),
      },
    },
    publications: {
      $: {
        live: val(
          initial ? undefined : { status: published ? 'runnable' : 'not-published', publication: published ? publication : null, hasUnpublishedChanges: true },
        ),
        publications: val(published ? [publication] : []),
        total: val(0),
        loadFailed: val(failedLoad),
        loading: val(loading),
        refreshing: val(false),
        loadingMore: val(false),
        loadMoreFailed: val(false),
        nextCursor: val(undefined),
        rollingBackPublicationId: val(undefined),
        changingTriggerId: val(undefined),
        bindings: val([]),
        detail: val(undefined),
        detailLoading: val(false),
        selectedTriggerId: val(undefined),
        testingTriggerId: val(undefined),
        testResult: val(undefined),
        activities: val([]),
        activitiesLoadFailed: val(false),
        activitiesLoading: val(false),
        activitiesLoadingMore: val(false),
        activitiesNextCursor: val(undefined),
      },
    },
  } as unknown as WorkbenchStore
  const i18n = createI18n('en')
  try {
    return renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <PublicationsView store={store} onClose={() => {}} />
      </I18nProvider>,
    )
  } finally {
    i18n.dispose()
  }
}

describe('PublicationsView state semantics', () => {
  it('opens the latest publication without Draft navigation or a redundant history heading', () => {
    const markup = renderState({ published: true })
    expect(markup).toContain('revision-published')
    expect(markup).toContain('Current Live')
    expect(markup).toContain('Live Triggers')
    expect(markup).not.toContain('Draft')
    expect(markup).not.toContain('Edit draft')
    expect(markup).not.toContain('Publish to Live')
    expect(markup).not.toMatch(/<h[1-6][^>]*>Publication history/)
  })

  it.each([false, true])('attributes publication actions correctly (restored=%s)', (restored) => {
    const markup = renderState({ published: true, restored })
    expect(markup).toContain(restored ? 'Restored by' : 'Published by')
    expect(markup).not.toContain(restored ? 'Published by' : 'Restored by')
    if (restored) {
      expect(markup).toContain('Restored from')
      expect(markup).not.toContain('Restored from version')
    }
    expect(markup).not.toContain('Disabled when replaced')
    expect(markup).not.toContain('Enabled when replaced')
  })

  it('shows the empty history without a Draft preview', () => {
    const markup = renderState()
    expect(markup).toContain('No publications yet')
    expect(markup).not.toContain('Publication snapshot')
    expect(markup).not.toContain('Draft')
  })

  it('distinguishes history load failure from an unpublished flow', () => {
    const markup = renderState({ failedLoad: true })
    expect(markup).toContain('could not be loaded')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('No publications yet')
    expect(markup).not.toContain('No Trigger bindings')
  })

  it.each([true, false])('does not announce empty history before Live is available (initial=%s)', (initial) => {
    const markup = renderState({ loading: !initial, initial })
    expect(markup).toContain('Loading Live')
    expect(markup).not.toContain('No publications yet')
  })
})
