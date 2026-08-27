import styles from './handle.module.scss'
import type { JSX } from 'react/jsx-runtime'

import { clsx } from 'clsx'
import { createContext, useContext } from 'react'

export type HandleKind = 'primitive' | 'bin' | 'string' | 'error'

export interface HandleProps {
  id?: string
  type: 'input' | 'output'
  /** Defaults to `"left"` if `type` is `"input"`, `"right"` if `type` is `"output"`. */
  position?: 'left' | 'right'
  className?: string
  active?: boolean
  hasData?: boolean
  // String handles currently use the default color to avoid excessive visual noise.
  /** Default is not colored. */
  kind?: HandleKind
  disabled?: boolean
  isConnectable?: boolean
  tabIndex?: number
  ariaHidden?: React.AriaAttributes['aria-hidden']
}

export function Handle(props: HandleProps): JSX.Element {
  const Component = useHandleContext()?.Handle ?? HandleImpl

  const position = props.position ?? (props.type === 'input' ? 'left' : 'right')

  return (
    <div
      className={clsx(styles.wrapper, position === 'left' ? styles.left : styles.right, props.disabled && styles.disabled, props.className)}
      style={props.kind && { ['--bg' as any]: `var(--edge-${props.kind})` }}
    >
      <Component
        id={props.id}
        type={props.type === 'input' ? 'target' : 'source'}
        position={position === 'left' ? 'left' : 'right'}
        className={clsx(styles.handle, props.active && styles.active, props.hasData && styles.hasData)}
        isConnectable={props.isConnectable}
        tabIndex={props.tabIndex}
        aria-hidden={props.ariaHidden}
      />
    </div>
  )
}

function HandleImpl(props: HandleImplProps) {
  return <div data-id={props.id} data-type={props.type} className={props.className} tabIndex={props.tabIndex} aria-hidden={props['aria-hidden']} />
}

export interface HandleImplProps extends React.AriaAttributes {
  id?: string
  type: 'source' | 'target'
  position: 'left' | 'right'
  className?: string
  isConnectable?: boolean
  tabIndex?: number
}

export type HandleImpl = React.ComponentType<HandleImplProps>
interface IHandleContext {
  // React Flow supplies its Handle component for drag recognition; the fallback renders a static handle.
  readonly Handle: HandleImpl
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
export function HandleContextProvider({ children, ...props }: HandleContextProps): JSX.Element {
  return <HandleContext.Provider value={props}>{children}</HandleContext.Provider>
}

export function useHandleContext(): IHandleContext | null {
  return useContext(HandleContext)
}
