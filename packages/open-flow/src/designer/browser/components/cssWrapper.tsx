declare module 'react/jsx-runtime' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'designer-css-wrapper': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

export interface CssWrapperProps {
  readonly css: React.CSSProperties & { [key: string]: unknown }
  readonly children?: React.ReactNode
}

/**
 * Add styles to its children but do not display itself.
 * ```jsx
 * <CssWrapper css={{ '--foo': 'bar' }}>
 * ```
 */
export function CssWrapper(props: CssWrapperProps): React.ReactElement {
  return <designer-css-wrapper style={{ display: 'contents', ...props.css }}>{props.children}</designer-css-wrapper>
}
