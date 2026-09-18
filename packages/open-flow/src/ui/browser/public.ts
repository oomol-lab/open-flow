import type { ComponentPropsWithoutRef, ComponentType, ForwardRefExoticComponent, ReactElement, ReactNode, RefAttributes, RefObject } from 'react'

import { createElement } from 'react'
import { Button as SharedButton } from './button.tsx'
import {
  Dialog as SharedDialog,
  DialogClose as SharedDialogClose,
  DialogContent as SharedDialogContent,
  DialogDescription as SharedDialogDescription,
  DialogFooter as SharedDialogFooter,
  DialogHeader as SharedDialogHeader,
  DialogTitle as SharedDialogTitle,
  DialogTrigger as SharedDialogTrigger,
} from './dialog.tsx'
import { InputGroup as SharedInputGroup, InputGroupAddon as SharedInputGroupAddon, InputGroupInput as SharedInputGroupInput } from './input-group.tsx'

/** Native host button contract; Base UI composition stays internal to the product. */
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'disclosure' | 'destructive' | 'link'
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
}
export const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>> = SharedButton as ForwardRefExoticComponent<
  ButtonProps & RefAttributes<HTMLButtonElement>
>
export interface DialogProps {
  readonly children?: ReactNode
  readonly defaultOpen?: boolean
  readonly modal?: boolean
  readonly onOpenChange?: (open: boolean, eventDetails: unknown) => void
  readonly open?: boolean
}
export interface DialogActionProps extends ComponentPropsWithoutRef<'button'> {
  readonly render?: ReactElement
}
export interface DialogContentProps extends ComponentPropsWithoutRef<'div'> {
  readonly closeLabel?: ReactNode
  readonly container?: HTMLElement | null
  readonly finalFocus?: boolean | HTMLElement | RefObject<HTMLElement | null> | (() => HTMLElement | null)
  readonly initialFocus?: boolean | HTMLElement | RefObject<HTMLElement | null> | (() => HTMLElement | null)
  readonly showCloseButton?: boolean
}
export const Dialog: ComponentType<DialogProps> = SharedDialog as ComponentType<DialogProps>
export const DialogTrigger: ComponentType<DialogActionProps> = SharedDialogTrigger as ComponentType<DialogActionProps>
export const DialogClose: ComponentType<DialogActionProps> = SharedDialogClose as ComponentType<DialogActionProps>
export const DialogContent: ComponentType<DialogContentProps> = SharedDialogContent as ComponentType<DialogContentProps>
export const DialogHeader: ComponentType<ComponentPropsWithoutRef<'div'>> = SharedDialogHeader
export const DialogFooter: ComponentType<ComponentPropsWithoutRef<'div'>> = SharedDialogFooter
export const DialogTitle: ComponentType<ComponentPropsWithoutRef<'h2'>> = SharedDialogTitle
export const DialogDescription: ComponentType<ComponentPropsWithoutRef<'p'>> = SharedDialogDescription
export { Input } from './input.tsx'
export const InputGroup: ComponentType<ComponentPropsWithoutRef<'div'>> = SharedInputGroup
export const InputGroupAddon: ComponentType<
  ComponentPropsWithoutRef<'div'> & { readonly align?: 'inline-start' | 'inline-end' | 'block-start' | 'block-end' }
> = SharedInputGroupAddon
export const InputGroupInput: ForwardRefExoticComponent<ComponentPropsWithoutRef<'input'> & RefAttributes<HTMLInputElement>> = SharedInputGroupInput
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
    { 'className': 'inline-flex items-center gap-1.5', 'data-notification-action-icon': 'start' },
    createElement('i', {
      'aria-hidden': true,
      'className': 'i-lucide:undo-2',
      'style': { width: 14, height: 14, flexShrink: 0, transform: 'translateY(-1px)' },
    }),
    children,
  )
}
