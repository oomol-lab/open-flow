import { useState, useRef } from 'react'

export function useBool(initialValueCreator: () => boolean): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useState(initialValueCreator())

  const toggle = () => setValue((currentValue) => !currentValue)

  return [value, toggle, setValue]
}

let nextComponentId = 1
const generateNextId = () => nextComponentId++

export function useComponentId(): string {
  const componentIdReference = useRef<string>()
  if (componentIdReference.current === undefined) {
    componentIdReference.current = `:ooj:${generateNextId()}:`
  }
  return componentIdReference.current
}
