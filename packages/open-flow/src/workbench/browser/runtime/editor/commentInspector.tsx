import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

const MarkdownContent = lazy(() => import('../../../../ui/browser/markdown/markdownContent.tsx'))

/** A comment is presentation data; editing it does not require the canvas store. */
export function CommentInspector({
  title,
  content,
  disabled,
  dark,
  onSave,
}: {
  readonly title: string
  readonly content: string
  readonly disabled: boolean
  readonly dark: boolean
  readonly onSave: (comment: { title: string; content: string }) => void
}) {
  const t = useTranslate()
  const [draftContent, setDraftContent] = useState(content)
  const [source, setSource] = useState(false)
  useEffect(() => setDraftContent(content), [content])
  const save = () => {
    if (!disabled && draftContent !== content) onSave({ title, content: draftContent })
  }
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col p-3">
      <Tabs className="min-h-0 flex-1" value={source ? 'source' : 'markdown'} onValueChange={(value) => setSource(value === 'source')}>
        <TabsList aria-label={t('inspector.title')} variant="flat" className="w-full shrink-0">
          <TabsTrigger value="source">{t('inspector.comment.source')}</TabsTrigger>
          <TabsTrigger value="markdown">{t('inspector.comment.preview')}</TabsTrigger>
        </TabsList>
        <TabsContent value="source" className="flex min-h-0 flex-1 flex-col">
          <Textarea
            aria-label={t('inspector.comment.source')}
            className="min-h-0 flex-1 resize-none field-sizing-fixed"
            disabled={disabled}
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            onBlur={save}
          />
        </TabsContent>
        <TabsContent
          value="markdown"
          className="min-h-0 flex-1 overflow-auto rounded-xl border border-[color-mix(in_srgb,var(--open-flow-comment-border)_45%,transparent)] bg-[var(--open-flow-comment-content)] p-3"
        >
          <div className="markdown-body min-w-0" onDoubleClick={() => setSource(true)}>
            <Suspense fallback={null}>
              <MarkdownContent dark={dark} text={draftContent} mermaid />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
