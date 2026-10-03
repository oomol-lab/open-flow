import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { OpenFlowWorkbench } from './openFlowWorkbench.tsx'

function render(flowId?: string): string {
  return renderToStaticMarkup(
    <OpenFlowWorkbench
      host={{
        notify: vi.fn(),
        openExternalPage: async () => false,
        request: vi.fn(),
        subscribeFlow: () => ({ ready: Promise.resolve(), stop() {} }),
        subscribeFlowCatalog: () => ({ ready: Promise.resolve(), stop() {} }),
      }}
      hrefFor={() => '/flows'}
      language="en"
      location={{ flowId, view: 'design' }}
      onNavigate={vi.fn()}
      preferences={{ getItem: () => null, setItem() {} }}
      sessionKey="initial-render"
      theme="light"
    />,
  )
}

it('renders the Flow list immediately with loading feedback and creation disabled', () => {
  const markup = render()

  expect(markup).toContain('Flows')
  expect(markup).toContain('Search by name')
  expect(markup).toContain('aria-busy="true"')
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?New Flow<\/button>/)
  expect(markup).not.toContain('No Flows yet')
})

it('does not flash the Flow list when starting on a Flow detail route', () => {
  const markup = render('selected-flow')

  expect(markup).toContain('aria-busy="true"')
  expect(markup).not.toContain('Search by name')
  expect(markup).not.toContain('New Flow')
})
