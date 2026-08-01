/**
 * Markdown renderer.
 *
 * The analyst prompts explicitly ask for Markdown tables ("append a Markdown
 * table" — see tradingagents/agents/analysts/news_analyst.py). The previous UI
 * assigned report text to `.textContent`, so every one of those tables reached
 * the user as raw pipes. remark-gfm is what turns them into real tables.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
