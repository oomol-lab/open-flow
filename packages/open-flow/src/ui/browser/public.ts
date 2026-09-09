import './theme.css'
import './styles.css'
import type { ComponentPropsWithoutRef, ForwardRefExoticComponent, RefAttributes } from 'react'

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
