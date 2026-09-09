export const contextPanelOverlayMaxWidth = 720

interface FocusTarget {
  focus(): void
}

type ObserveWidth = (element: Element, onWidth: (width: number) => void) => () => void

export function observeElementWidth(element: Element, onWidth: (width: number) => void, resizeObserverOverride?: typeof ResizeObserver | null): () => void {
  const ResizeObserverConstructor =
    resizeObserverOverride === undefined ? (element.ownerDocument.defaultView?.ResizeObserver ?? globalThis.ResizeObserver) : resizeObserverOverride
  if (ResizeObserverConstructor == null) return () => undefined

  const observer = new ResizeObserverConstructor((entries) => {
    const entry = entries[0]
    if (entry != null) onWidth(entry.contentRect.width)
  })
  observer.observe(element)
  return () => observer.disconnect()
}

export function observeContextPanelOverlay(
  root: HTMLElement,
  onOverlayChange: (overlay: boolean) => void,
  observeWidth: ObserveWidth = observeElementWidth,
): () => void {
  let current: boolean | undefined
  const update = (width: number): void => {
    const next = width <= contextPanelOverlayMaxWidth
    if (next == current) return
    current = next
    onOverlayChange(next)
  }
  const disconnect = observeWidth(root, update)
  update(root.getBoundingClientRect().width)
  return disconnect
}

export function cycleContextPanelFocus(panel: FocusTarget, focusable: readonly FocusTarget[], activeElement: unknown, backwards: boolean): boolean {
  if (focusable.length == 0) {
    panel.focus()
    return true
  }

  const first = focusable[0]!
  const last = focusable.at(-1)!
  if (backwards && (activeElement == first || activeElement == panel)) {
    last.focus()
    return true
  }
  if (!backwards && (activeElement == last || activeElement == panel)) {
    first.focus()
    return true
  }
  return false
}
