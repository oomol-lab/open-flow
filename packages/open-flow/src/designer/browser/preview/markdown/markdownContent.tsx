import 'katex/dist/katex.css'
import './gfm.light.scss'
import './gfm.dark.scss'
import './highlight.light.scss'
import './highlight.dark.scss'
import type { FC } from 'react'
import type { Components, Options } from 'react-markdown'
import type { RehypeRewriteOptions } from 'rehype-rewrite'
import type { TFunction } from 'val-i18n'

import { isString } from '@wopjs/cast'
import deepmerge from 'deepmerge'
import { memo, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeRewrite from 'rehype-rewrite'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useTranslate } from 'val-i18n-react'

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath, remarkFrontmatter]
type RewriteNode = Parameters<RehypeRewriteOptions['rewrite']>[0]

function createRewriteOptions(t: TFunction): RehypeRewriteOptions {
  return {
    rewrite: (node) => {
      if (node.type == 'element') {
        if (isString(node.properties.src)) {
          node.properties.src = node.properties.src.replace(/([^:/])\/+/g, '$1/')
        }
        if (isString(node.properties.href)) {
          node.properties.href = node.properties.href.replace(/([^:/])\/+/g, '$1/')
        }
      }
      rewriteMaybeVideoLinkToIframe(node, t)
    },
  }
}

function createRehypePlugins(t: TFunction): Options['rehypePlugins'] {
  return [
    rehypeRaw,
    rehypeHighlight,
    rehypeKatex,
    [rehypeRewrite, createRewriteOptions(t)],
    [
      rehypeSanitize,
      deepmerge(defaultSchema, {
        tagNames: ['video', 'iframe'],
        attributes: {
          'video': ['src', 'controls', 'autoplay', 'loop', 'muted'],
          'source': ['src', 'type'],
          'iframe': ['src', 'allow', 'referrerpolicy', 'allowfullscreen'],
          '*': ['className', 'style'],
        },
      }),
    ],
  ]
}

// Embedded video links are available only in HTTP(S) browser contexts.
let isWebProtocol = false
if (typeof window !== 'undefined') {
  const protocol = window.location.protocol
  isWebProtocol = protocol === 'http:' || protocol === 'https:'
}

function rewriteMaybeVideoLinkToIframe(node: RewriteNode, t: TFunction): void {
  if (!isWebProtocol) {
    return
  }
  const firstChild = node.type == 'element' ? node.children[0] : undefined
  if (node.type === 'element' && node.tagName === 'a' && firstChild?.type == 'element' && firstChild.tagName === 'img') {
    const href = node.properties.href
    if (isString(href) && isSupportedVideoLink(href)) {
      inPlaceEditVideoLink(node, href, t)
    }
  }
}

const youtubeRegex = /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/
const bilibiliRegex = /https?:\/\/(?:www\.)?bilibili\.com\/video\/BV([a-zA-Z0-9]+)/

const commonIframeProps = {
  width: '100%',
  height: 'auto',
  frameborder: '0',
  allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  referrerpolicy: 'strict-origin-when-cross-origin',
  allowfullscreen: true,
}

function isSupportedVideoLink(url: string): boolean {
  return youtubeRegex.test(url) || bilibiliRegex.test(url)
}

function inPlaceEditVideoLink(node: Extract<RewriteNode, { type: 'element' }>, url: string, t: TFunction): void {
  let match = url.match(youtubeRegex)
  if (match) {
    const videoId = match[1]
    node.tagName = 'iframe'
    node.properties = {
      src: `https://www.youtube.com/embed/${videoId}`,
      title: t('preview.videoYouTube'),
      ...commonIframeProps,
    }
    node.children = []
  }
  match = url.match(bilibiliRegex)
  if (match) {
    const videoId = match[1]
    node.tagName = 'iframe'
    node.properties = {
      src: `https://player.bilibili.com/player.html?bvid=${videoId}`,
      title: t('preview.videoBilibili'),
      ...commonIframeProps,
    }
    node.children = []
  }
}

export interface MarkdownContentProps {
  dark: boolean
  text?: string
  className?: string
  components?: Components
  mermaid?: boolean
}

const MarkdownContent: FC<MarkdownContentProps> = /* @__PURE__ */ memo(function MarkdownContent({ dark, text, className = '', components, mermaid }) {
  const t = useTranslate()
  const rehypePlugins = useMemo(() => createRehypePlugins(t), [t])
  const ref = useRef<HTMLDivElement>(null)
  const diagramSourcesRef = useRef(new WeakMap<HTMLElement, string>())

  useEffect(() => {
    const elements = mermaid ? [...(ref.current?.querySelectorAll<HTMLElement>('pre code.language-mermaid') ?? [])] : []
    if (elements.length == 0) return

    let canceled = false
    const render = async (): Promise<void> => {
      const { renderMermaidSVG, THEMES } = await import('beautiful-mermaid')
      if (canceled) return
      const theme = THEMES[dark ? 'github-dark' : 'github-light']
      for (const element of elements) {
        const previousSource = diagramSourcesRef.current.get(element)
        const source = element.querySelector('svg') && previousSource != null ? previousSource : element.textContent || ''
        diagramSourcesRef.current.set(element, source)
        try {
          const svg = renderMermaidSVG(source, { ...theme, transparent: true })
          if (!canceled) element.innerHTML = svg
        } catch (error) {
          console.error('Failed to render Mermaid preview.', error)
        }
      }
    }
    void render().catch((error) => console.error('Failed to render Mermaid preview.', error))
    return () => {
      canceled = true
    }
  }, [mermaid, dark, text])

  if (!text) {
    return null
  }
  return (
    <div ref={ref} className={`designer-markdown-${dark ? 'dark' : 'light'} ${className}`}>
      <ReactMarkdown rehypePlugins={rehypePlugins} remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownContent
