import type { Diagnostic } from '@codemirror/lint'
import type { Transport } from '@codemirror/lsp-client'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import { javascript } from '@codemirror/lang-javascript'
import { linter } from '@codemirror/lint'
import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client'
import { activateHover, keymap } from '@codemirror/view'
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

function showHover(view: EditorView): boolean {
  const head = view.state.selection.main.head
  const word = view.state.wordAt(head) ?? (head == 0 ? null : view.state.wordAt(head - 1))
  const pos = word == null ? head : Math.min(Math.max(head, word.from), word.to - 1)
  activateHover(view, pos, 1, { until: (transaction) => transaction.docChanged || transaction.selection != null })
  return true
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
  const client = new LSPClient({
    extensions: [...languageServerExtensions(), keymap.of([{ key: 'Mod-k Mod-i', preventDefault: true, run: showHover }])],
    highlightLanguage,
    sanitizeHTML: openLinksInNewTab,
    timeout: 60_000,
  })
  await client.connect(createTransport(worker))
  return { client, worker }
}

export async function loadTypeScriptExtension(uri: string, typing: string): Promise<Extension> {
  sessionPromise ??= createSession()
  const session = await sessionPromise
  session.client.notification('openFlow/typing', { typing, uri })
  return [
    session.client.plugin(uri, 'javascript'),
    linter(
      async () => {
        session.client.sync()
        return await session.client.request<{ uri: string }, Diagnostic[]>('openFlow/syntaxDiagnostics', { uri })
      },
      { delay: 300 },
    ),
  ]
}

export async function updateTypeScriptTyping(uri: string, typing: string): Promise<void> {
  if (sessionPromise == null) return
  const session = await sessionPromise
  session.client.notification('openFlow/typing', { typing, uri })
}
