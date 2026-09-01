declare module '*.module.scss' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.scss'
declare module '*.png' {
  const source: string
  export default source
}
declare module '*.svg' {
  const source: string
  export default source
}
declare module 'virtual:uno.css'
declare module 'virtual:oomol-provider-icons' {
  const iconUrls: Readonly<Record<string, string>>
  export default iconUrls
}
declare module 'virtual:open-flow-twemoji' {
  import type { IconifyJSONPackageExports } from '@iconify/types'

  const data: IconifyJSONPackageExports
  export default data
}
declare module '*?raw' {
  const source: string
  export default source
}
declare module '*?worker&inline' {
  const Worker: new () => Worker
  export default Worker
}
