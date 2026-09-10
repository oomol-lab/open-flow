import type { CanvasStore } from '../stores/canvas/canvas.store.ts'

import { createContext, useContext } from 'react'

export const CanvasDarkContext = createContext(false)

const CanvasStoreContext: React.Context<CanvasStore | null> = createContext<CanvasStore | null>(null)

export const CanvasStoreProvider: React.FC<{
  readonly dark: boolean
  readonly value: CanvasStore | null
  readonly children?: React.ReactNode
}> = (props) => {
  return (
    <CanvasStoreContext.Provider value={props.value}>
      <CanvasDarkContext.Provider value={props.dark}>{props.children}</CanvasDarkContext.Provider>
    </CanvasStoreContext.Provider>
  )
}

export const useCanvasStore = (): CanvasStore => {
  const context = useContext(CanvasStoreContext)
  if (!context) {
    throw new Error('DesignerContext not found')
  }
  return context
}
