/// <reference types="vite/client" />

declare module 'virtual:oomol-provider-icons' {
  const iconUrls: Readonly<Record<string, string>>
  export default iconUrls
}

declare module 'virtual:open-flow-twemoji' {
  const data: import('@iconify/types').IconifyJSONPackageExports
  export default data
}
