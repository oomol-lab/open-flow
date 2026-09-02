import type { ReactElement, ReactNode, SVGProps } from 'react'

export type IconName =
  | 'alert'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-up'
  | 'close'
  | 'condition'
  | 'connection'
  | 'download'
  | 'filter'
  | 'fit'
  | 'flow'
  | 'hand'
  | 'logo'
  | 'llm'
  | 'more'
  | 'panel'
  | 'play'
  | 'pointer'
  | 'plus'
  | 'project'
  | 'publish'
  | 'refresh'
  | 'run'
  | 'search'
  | 'settings'
  | 'subflow'
  | 'task'
  | 'trash'
  | 'trigger'
  | 'value'
  | 'wait'

function glyph(name: IconName): ReactNode {
  switch (name) {
    case 'alert':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6" />
          <path d="M12 17h.01" />
        </>
      )
    case 'check':
      return <path d="m5 12 4 4L19 6" />
    case 'chevron-down':
      return <path d="m7 10 5 5 5-5" />
    case 'chevron-left':
      return <path d="m15 18-6-6 6-6" />
    case 'chevron-up':
      return <path d="m7 14 5-5 5 5" />
    case 'close':
      return (
        <>
          <path d="m6 6 12 12" />
          <path d="M18 6 6 18" />
        </>
      )
    case 'condition':
      return (
        <>
          <path d="M5 5h14l-5.5 6v6l-3 2v-8z" />
        </>
      )
    case 'connection':
      return (
        <>
          <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
          <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
        </>
      )
    case 'download':
      return (
        <>
          <path d="M12 4v11" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 20h14" />
        </>
      )
    case 'fit':
      return (
        <>
          <path d="M8 3H3v5" />
          <path d="M16 3h5v5" />
          <path d="M8 21H3v-5" />
          <path d="M16 21h5v-5" />
        </>
      )
    case 'filter':
      return <path d="M4 6h16l-6 7v5l-4 2v-7z" />
    case 'flow':
      return (
        <>
          <circle cx="12" cy="5" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M12 7v4M6 16v-3h12v3" />
        </>
      )
    case 'hand':
      return <path d="M8 11V6a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v4a8 8 0 0 1-16 0v-2a2 2 0 0 1 4 0Z" />
    case 'logo':
      return (
        <>
          <circle cx="7" cy="5" r="2.5" />
          <circle cx="7" cy="19" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <path d="M9.2 6.2 15.7 10M9.2 17.8l6.5-3.8M7 7.5v9" />
        </>
      )
    case 'llm':
      return (
        <>
          <path d="M7 7h10v10H7z" />
          <path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" />
          <circle cx="10" cy="11" r=".7" fill="currentColor" stroke="none" />
          <circle cx="14" cy="11" r=".7" fill="currentColor" stroke="none" />
          <path d="M10 14h4" />
        </>
      )
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )
    case 'panel':
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
        </>
      )
    case 'play':
    case 'run':
      return <path d="m8 5 11 7-11 7z" />
    case 'pointer':
      return <path d="m5 3 13 9-6 1-3 6z" />
    case 'plus':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      )
    case 'project':
      return (
        <>
          <path d="M3 7h6l2 2h10v10H3z" />
          <path d="M3 7V5h7l2 2" />
        </>
      )
    case 'publish':
      return (
        <>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 14v5h14v-5" />
        </>
      )
    case 'refresh':
      return (
        <>
          <path d="M20 11a8 8 0 0 0-14.7-4.4L3 9" />
          <path d="M3 4v5h5" />
          <path d="M4 13a8 8 0 0 0 14.7 4.4L21 15" />
          <path d="M21 20v-5h-5" />
        </>
      )
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 4 4" />
        </>
      )
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19 13.5v-3l-2-.6-.7-1.7 1-1.8-2.1-2.1-1.8 1-1.7-.7L10.5 3h-3l-.6 2-1.7.7-1.8-1-2.1 2.1 1 1.8-.7 1.7-2 .6v3l2 .6.7 1.7-1 1.8 2.1 2.1 1.8-1 1.7.7.6 2h3l.6-2 1.7-.7 1.8 1 2.1-2.1-1-1.8.7-1.7z"
            transform="translate(2.5) scale(.8)"
          />
        </>
      )
    case 'subflow':
      return (
        <>
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="14" width="6" height="6" rx="1" />
          <path d="M10 7h4a3 3 0 0 1 3 3v4M14 17h-4a3 3 0 0 1-3-3v-4" />
        </>
      )
    case 'value':
      return <path d="m12 3 8 9-8 9-8-9z" />
    case 'wait':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )
    case 'task':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="m9 12 2 2 4-5" />
        </>
      )
    case 'trigger':
      return (
        <>
          <path d="M13 2 5 14h6l-1 8 8-12h-6z" />
        </>
      )
    case 'trash':
      return (
        <>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m6 7 1 13h10l1-13" />
          <path d="M10 11v5M14 11v5" />
        </>
      )
  }
}

export function Icon({ name, size = 18, ...props }: { readonly name: IconName; readonly size?: number } & SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} {...props}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        {glyph(name)}
      </g>
    </svg>
  )
}
