import type { ReactNode } from 'react'

import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '../../src/ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../src/ui/browser/dropdown-menu.tsx'

interface StoryAction {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
}

function createActionsStore() {
  let actions: readonly StoryAction[] = []
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => actions,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: readonly StoryAction[]) {
      actions = next
      listeners.forEach((listener) => listener())
    },
  }
}

const ActionsContext = createContext<ReturnType<typeof createActionsStore> | null>(null)

export function StoryActionsProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState(createActionsStore)
  return <ActionsContext.Provider value={store}>{children}</ActionsContext.Provider>
}

// The toolbar subscribes separately so publishing callbacks does not rerender the Story.
export function useStoryActions(actions: readonly StoryAction[]) {
  const store = useContext(ActionsContext)
  useLayoutEffect(() => {
    store?.set(actions)
    return () => store?.set([])
  }, [store, actions])
}

export function StoryActions() {
  const store = useContext(ActionsContext)!
  const actions = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (!actions.length) return null
  return (
    <div className="lab-story-actions" role="group" aria-label="Story actions">
      {actions.slice(0, 5).map((action, index) => (
        <Button
          key={index}
          variant="outline"
          size="sm"
          className="text-xs font-normal active:not-aria-[haspopup]:translate-y-0"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
      {actions.length > 5 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label="More actions" title="More actions">
            <i aria-hidden="true" className="i-lucide:ellipsis size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {actions.slice(5).map((action, index) => (
              <DropdownMenuItem key={index} disabled={action.disabled} onClick={action.onClick}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
