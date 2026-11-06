// @vitest-environment happy-dom
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from '../../../../../test/support/render.tsx'
import { WorkspacePublishIsland } from './workspacePublishIsland.tsx'

async function activate(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
}

it('opens the PNG panel after closing the action menu', async () => {
  const onOpenPngExport = vi.fn()
  const view = render(
    <WorkspacePublishIsland
      hasPublications={false}
      onOpenPngExport={onOpenPngExport}
      onOpenPublications={() => {}}
      onOpenRuns={() => {}}
      onPublish={() => {}}
      state="current"
    />,
  )
  await activate(view.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
  const item = [...view.container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.includes('Export PNG image'))!
  expect(item.getAttribute('aria-haspopup')).not.toBe('menu')
  await activate(item)
  await vi.waitFor(() => expect(onOpenPngExport).toHaveBeenCalledOnce())
  expect(view.container.querySelector('[role="menuitemcheckbox"]')).toBeNull()
})
