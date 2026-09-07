import type { FlowDesignerViewProps } from './model.ts'

import { createContext } from 'react'

export const CanvasContext = createContext<Pick<FlowDesignerViewProps, 'model' | 'inspectorContainer' | 'selectedNodeIds'> | undefined>(undefined)
