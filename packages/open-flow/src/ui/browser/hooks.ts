import { forwardRef, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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

// Another `forwardRef` that will keep functional components' generic types.
// https://stackoverflow.com/questions/58469229/react-with-typescript-generics-while-using-react-forwardref
export const forwardRef2 = forwardRef as <T, P = {}>(
  render: (props: P, ref: React.ForwardedRef<T>) => React.ReactElement | null,
) => (props: P & React.RefAttributes<T>) => React.ReactElement | null

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
