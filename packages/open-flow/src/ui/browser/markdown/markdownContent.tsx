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
import { getVideoLink } from './videoLink.ts'

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
          'iframe': ['src', 'allow', 'referrerPolicy', 'allowFullScreen'],
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
  if (!isWebProtocol || node.type !== 'element' || node.tagName !== 'a') {
    return
  }
  const href = node.properties.href
  const firstChild = node.children[0]
  if (!isString(href) || firstChild?.type !== 'element' || firstChild.tagName !== 'img') {
    return
  }
  const video = getVideoLink(href)
  if (video) {
    node.tagName = 'iframe'
    node.properties = { ...commonIframeProps, src: video.src, title: t(video.titleKey) }
    node.children = []
  }
}

const commonIframeProps = {
  style: 'display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 0; border-radius: 8px',
  allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  referrerPolicy: 'strict-origin-when-cross-origin',
  allowFullScreen: true,
}

export interface MarkdownContentProps {
  dark: boolean
  unstyled?: boolean
  text?: string
  className?: string
  components?: Components
  mermaid?: boolean
}

const MarkdownContent: FC<MarkdownContentProps> = /* @__PURE__ */ memo(function MarkdownContent({ dark, unstyled, text, className = '', components, mermaid }) {
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
    <div ref={ref} className={`${unstyled ? '' : `open-flow-markdown-${dark ? 'dark' : 'light'}`} ${className}`}>
      <ReactMarkdown rehypePlugins={rehypePlugins} remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

export default MarkdownContent
