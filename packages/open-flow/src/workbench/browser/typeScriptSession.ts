import type { Transport } from '@codemirror/lsp-client'
import type { Extension } from '@codemirror/state'

import { javascript } from '@codemirror/lang-javascript'
import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client'
// oxlint-disable-next-line import/default
import TypeScriptWorker from './typeScriptWorker.ts?worker&inline'

let sessionPromise: ReturnType<typeof createSession> | undefined
const typeScriptLanguage = javascript({ typescript: true }).language

function highlightLanguage(name: string) {
  switch (name.toLowerCase()) {
    case 'javascript':
    case 'js':
    case 'jsx':
    case 'typescript':
    case 'ts':
    case 'tsx':
      return typeScriptLanguage
    default:
      return null
  }
}

function openLinksInNewTab(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const link of template.content.querySelectorAll('a')) {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
  return template.innerHTML
}

function createTransport(worker: Worker): Transport {
  const handlers = new Set<(value: string) => void>()
  worker.addEventListener('message', (event) => {
    const value = JSON.stringify(event.data)
    for (const handler of handlers) handler(value)
  })
  return {
    send(value) {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage(JSON.parse(value))
    },
    subscribe(handler) {
      handlers.add(handler)
    },
    unsubscribe(handler) {
      handlers.delete(handler)
    },
  }
}

async function createSession() {
  const worker = new TypeScriptWorker()
  const client = new LSPClient({ extensions: languageServerExtensions(), highlightLanguage, sanitizeHTML: openLinksInNewTab, timeout: 60_000 })
  await client.connect(createTransport(worker))
  return { client, worker }
}

export async function loadTypeScriptExtension(uri: string): Promise<Extension> {
  sessionPromise ??= createSession()
  const session = await sessionPromise
  return session.client.plugin(uri, 'javascript')
}
