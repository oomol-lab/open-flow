import styles from './handle.module.scss'

import { clsx } from 'clsx'
import { createContext, useContext } from 'react'

export type HandlePosition = 'left' | 'right' | 'top' | 'bottom'

export interface HandleProps {
  id?: string
  type: 'input' | 'output'
  /** Defaults to `"left"` if `type` is `"input"`, `"right"` if `type` is `"output"`. */
  position?: HandlePosition
  selected?: boolean
  className?: string
  isConnectable?: boolean
  children?: React.ReactNode
  tabIndex?: number
  ariaHidden?: React.AriaAttributes['aria-hidden']
}

export function Handle(props: HandleProps): React.ReactElement | null {
  const context = useHandleContext()
  if (context != null && context.Handle == null) return null
  const Component = context?.Handle ?? HandleImpl

  const position = props.position ?? (props.type === 'input' ? 'left' : 'right')

  return (
    <div className={clsx(styles.wrapper, styles[position], props.selected && styles.selected, props.className)}>
      <Component
        id={props.id}
        type={props.type === 'input' ? 'target' : 'source'}
        position={position}
        className={styles.handle}
        isConnectable={props.isConnectable}
        tabIndex={props.tabIndex}
        aria-hidden={props.ariaHidden}
      />
      {props.children}
    </div>
  )
}

function HandleImpl(props: HandleImplProps) {
  return <div data-id={props.id} data-type={props.type} className={props.className} tabIndex={props.tabIndex} aria-hidden={props['aria-hidden']} />
}

export interface HandleImplProps extends React.AriaAttributes {
  id?: string
  type: 'source' | 'target'
  position: HandlePosition
  className?: string
  isConnectable?: boolean
  tabIndex?: number
}

export type HandleImpl = React.ComponentType<HandleImplProps>
interface IHandleContext {
  // React Flow supplies its Handle component for drag recognition; the fallback renders a static handle.
  readonly Handle: HandleImpl | null
}

export const HandleContext: React.Context<IHandleContext | null> = /*#__PURE__*/ createContext<IHandleContext | null>(null)

interface HandleContextProps {
  Handle: HandleImpl
  children?: React.ReactNode
}

/**
 * ```jsx
 * import { Handle } from 'reactflow'
 * <HandleContextProvider value={{ Handle }}><ReactFlow /></HasReactFlow>
 * ```
 */
export function HandleContextProvider({ children, ...props }: HandleContextProps): React.ReactElement {
  return <HandleContext.Provider value={props}>{children}</HandleContext.Provider>
}

export function useHandleContext(): IHandleContext | null {
  return useContext(HandleContext)
}
