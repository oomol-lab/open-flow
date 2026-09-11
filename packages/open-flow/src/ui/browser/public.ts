import './theme.css'
import './styles.css'
import type { ComponentPropsWithoutRef, ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react'

import { createElement } from 'react'
import { Button as SharedButton } from './button.tsx'

/** Native host button contract; Base UI composition stays internal to the product. */
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'disclosure' | 'destructive' | 'link'
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
}
export const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>> = SharedButton as ForwardRefExoticComponent<
  ButtonProps & RefAttributes<HTMLButtonElement>
>
export { Input } from './input.tsx'
export { Label } from './label.tsx'
export { Textarea } from './textarea.tsx'
/** Shared Sonner presentation for hosts and the component Lab. */
export const notificationToasterProps = {
  className: 'open-flow-notifications',
  closeButton: true,
  expand: false,
  gap: 8,
  mobileOffset: { top: 56, left: 12, right: 12 },
  offset: { top: 56, left: 16, right: 16 },
  position: 'top-center',
  visibleToasts: 3,
} as const

export function NotificationUndoLabel({ children }: { children: ReactNode }): ReactNode {
  return createElement(
    'span',
    { className: 'inline-flex items-center gap-1.5' },
    createElement('i', { 'aria-hidden': true, 'className': 'i-lucide-light:undo-2', 'style': { width: 16, height: 16, flexShrink: 0 } }),
    children,
  )
}
