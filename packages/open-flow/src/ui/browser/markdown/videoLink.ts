import type { ClipboardEvent } from 'react'
import type { TFunction } from 'val-i18n'

export function getVideoLink(href: string): { src: string; titleKey: 'markdown.videoYouTube' | 'markdown.videoBilibili' } | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  const host = url.hostname.replace(/^www\./, '')
  const youtubeId = host === 'youtube.com' && url.pathname === '/watch' ? url.searchParams.get('v') : host === 'youtu.be' ? url.pathname.slice(1) : null
  if (youtubeId && /^[a-zA-Z0-9_-]+$/.test(youtubeId)) {
    return {
      src: `https://www.youtube.com/embed/${youtubeId}`,
      titleKey: 'markdown.videoYouTube',
    }
  }
  const bilibiliId = host === 'bilibili.com' ? url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]+)\/?$/)?.[1] : undefined
  if (bilibiliId) {
    return {
      src: `https://player.bilibili.com/player.html?bvid=${bilibiliId}&autoplay=0`,
      titleKey: 'markdown.videoBilibili',
    }
  }
}

export function pasteVideoLink(event: ClipboardEvent<HTMLTextAreaElement>, t: TFunction): void {
  const textarea = event.currentTarget
  if (event.defaultPrevented || textarea.readOnly || textarea.disabled) return
  const href = event.clipboardData.getData('text/plain').trim()
  if (/\s/.test(href)) return
  const video = getVideoLink(href)
  if (!video) return
  const destination = href.replaceAll('(', '%28').replaceAll(')', '%29')
  const markdown = `[![${t(video.titleKey)}](thumbnail.jpg)](${destination})`
  event.preventDefault()
  // Native insertion preserves the textarea's selection, input events and undo history.
  textarea.ownerDocument.execCommand('insertText', false, markdown)
}
