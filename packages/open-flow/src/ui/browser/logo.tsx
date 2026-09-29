import type { ComponentPropsWithoutRef } from 'react'

import darkLogo from '../../../../../assets/logo/open-flow-dark.svg'
import lightLogo from '../../../../../assets/logo/open-flow-light.svg'

export interface OpenFlowLogoProps extends Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'srcSet'> {
  readonly theme: 'light' | 'dark'
}

export function OpenFlowLogo({ theme, alt = 'Open Flow', width = 24, height = 24, style, ...props }: OpenFlowLogoProps) {
  return (
    <img
      {...props}
      src={theme === 'dark' ? darkLogo : lightLogo}
      alt={alt}
      width={width}
      height={height}
      style={{ flexShrink: 0, objectFit: 'contain', ...style }}
    />
  )
}
