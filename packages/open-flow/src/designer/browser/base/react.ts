import { Children, forwardRef, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useIsMounted(): () => boolean {
  const isMounted = useRef(false)

  useLayoutEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  return useCallback(() => isMounted.current, [])
}

export function useUpdateEffect(effect: React.EffectCallback, deps?: any[]): void {
  const init = useRef(true)
  const isFirst = init.current
  init.current = false
  useEffect(function runUpdateEffect() {
    if (!isFirst) effect()
  }, deps)
}

// Another `forwardRef` that will keep functional components' generic types.
// https://stackoverflow.com/questions/58469229/react-with-typescript-generics-while-using-react-forwardref
export const forwardRef2 = forwardRef as <T, P = {}>(
  render: (props: P, ref: React.ForwardedRef<T>) => React.ReactElement | null,
) => (props: P & React.RefAttributes<T>) => React.ReactElement | null

export interface SlotConfig {
  [key: string]: React.ElementType
}

export type SlotElements<Config extends SlotConfig> = {
  [Key in keyof Config]: SlotValue<Config, Key>
}

export type SlotValue<Config, Key extends keyof Config> = Config[Key] extends React.ElementType
  ? React.ReactElement<React.ComponentPropsWithoutRef<Config[Key]>, Config[Key]>
  : never

/**
 * ```jsx
 * const [slots, children] = useSlots(props.children, {
 *   header: FormHeader,
 * })
 * return <header>{slots.header}></header>
 * ```
 */
export function useSlots<Config extends SlotConfig>(children: React.ReactNode, config: Config): [Partial<SlotElements<Config>>, React.ReactNode[]] {
  const slots: Partial<SlotElements<Config>> = mapValues(config, () => undefined)

  const rest: React.ReactNode[] = []

  const keys = Object.keys(config) as (keyof Config)[]
  const values = Object.values(config)

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      rest.push(child)
      return
    }

    const index = values.findIndex((value) => equal(child.type, value))
    if (index < 0) {
      rest.push(child)
      return
    }

    const slotKey = keys[index]

    if (slots[slotKey]) {
      // Duplicate slots are ignored.
      return
    }

    slots[slotKey] = child as SlotValue<Config, keyof Config>
  })

  return [slots, rest]
}

function equal(a: string | React.ElementType, b: React.ElementType): boolean {
  return a === b || (a as any).displayName === (b as any).displayName
}

function mapValues<T extends Record<string, unknown>, V>(obj: T, fn: (value: T[keyof T]) => V) {
  return Object.keys(obj).reduce(
    (acc, key: keyof T) => {
      acc[key] = fn(obj[key])
      return acc
    },
    {} as Record<keyof T, V>,
  )
}

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    let isMounted = true
    const timer = setTimeout(() => {
      if (isMounted) {
        setDebouncedValue(value)
      }
    }, delay)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [value, delay])

  return debouncedValue
}

export function useDelayedTrue(value: boolean, delay: number): boolean {
  const [displayed, setDisplayed] = useState(false)

  useEffect(() => {
    if (!value) {
      setDisplayed(false)
      return
    }
    const timer = setTimeout(() => setDisplayed(true), delay)
    return () => clearTimeout(timer)
  }, [delay, value])

  return displayed
}

export function isEmptyReactNode(node: React.ReactNode): boolean {
  if (node == null) return true
  if (typeof node === 'string' || typeof node === 'number') return false
  if (Array.isArray(node)) return node.every(isEmptyReactNode)
  if (isValidElement(node)) return false
  return true
}
