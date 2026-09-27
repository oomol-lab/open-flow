import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { PublicationsView } from './publicationsView.tsx'

vi.mock('../editor/revisionCanvas.tsx', () => ({
  RevisionCanvas: ({ draft, label }: { draft: { revisionId: string }; label: string }) => <section aria-label={label} data-revision={draft.revisionId} />,
}))

function renderState({ failedLoad = false, failedPublish = false, published = false, loading = false, initial = false } = {}) {
  const publication = { publicationId: 'publication-current', revisionId: 'revision-published' }
  const store = {
    $: { busy: val(undefined), diagnostics: val(undefined) },
    workspace: {
      $: {
        flowId: val('flow'),
        targetFlow: val({ flowId: 'flow', name: 'Customer onboarding', status: 'active' }),
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
        publications: val([]),
        total: val(0),
        loadFailed: val(failedLoad),
        loading: val(loading),
        refreshing: val(false),
        loadingMore: val(false),
        loadMoreFailed: val(false),
        nextCursor: val(undefined),
        rollingBackPublicationId: val(undefined),
        operation: val(failedPublish ? { status: 'failed', issue: { code: 'publication.deadline-exceeded', message: 'Preparation timed out.' } } : undefined),
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
  it('keeps publishing guidance in Draft without exposing Live operations', () => {
    const markup = renderState({ published: true })
    expect(markup).toContain('Draft</h2>')
    expect(markup).toContain('Edit draft')
    expect(markup).toContain('aria-label="Publish preview"')
    expect(markup).toContain('data-revision="revision-draft"')
    expect(markup).not.toContain('View current publication')
    expect(markup).toContain('Publish to Live')
    expect(markup).toContain('Unpublished changes')
    expect(markup).not.toContain('Live Triggers')
    expect(markup).not.toContain('role="switch"')
    expect(markup).not.toContain('Current Live</h2>')
  })

  it('distinguishes history load failure from an unpublished flow', () => {
    const markup = renderState({ failedLoad: true })
    expect(markup).toContain('could not be loaded')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('No publications yet')
    expect(markup).not.toContain('No Trigger bindings')
  })

  it.each([true, false])('scopes a failed publish to the operation when published=%s', (published) => {
    const markup = renderState({ failedPublish: true, published })
    expect(markup).toContain('Publishing failed')
    expect(markup).toContain('Preparation timed out.')
    expect(markup).toContain(published ? 'The current Live publication is unchanged.' : 'This flow has not been published.')
    expect(markup).not.toContain(published ? 'This flow has not been published.' : 'The current Live publication is unchanged.')
  })

  it.each([true, false])('does not announce empty history before Live is available (initial=%s)', (initial) => {
    const markup = renderState({ loading: !initial, initial })
    expect(markup).toContain('Loading Live')
    expect(markup).not.toContain('No publications yet')
  })
})
