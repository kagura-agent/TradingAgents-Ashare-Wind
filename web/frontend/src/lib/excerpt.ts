/**
 * Markdown reduced to the one line that fits in a speech bubble.
 *
 * The office draws each member's output above their head, where a heading
 * marker or a table pipe is noise rather than structure. This is deliberately
 * lossy: anything needing the real formatting is one click away in NodeDetail.
 */

/**
 * First `max` characters of `markdown` as plain prose, ellipsised if cut.
 *
 * Underscores are left alone — `_emphasis_` is rare in the models' Chinese
 * output, while identifiers like `market_report` are not, and mangling those
 * costs more than the stray marker saves.
 */
export function excerpt(markdown: string, max: number): string {
  const text = markdown
    // Fenced code first, so its contents never reach the marker passes below.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?[-:|\s]+\|[-:|\s]*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}
