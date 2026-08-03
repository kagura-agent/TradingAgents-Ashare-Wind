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
/**
 * Strip markdown to plain text (shared helper for both excerpt functions).
 */
function stripMarkdown(markdown: string): string {
  return markdown
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
}

/** Truncate `text` to `max` characters with ellipsis if needed. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}

export function excerpt(markdown: string, max: number): string {
  const text = stripMarkdown(markdown)
  return truncate(text, max)
}

// ---------------------------------------------------------------------------
// Conclusion markers — ordered by specificity so the first match wins.
// Each pattern captures an optional action keyword and a reason fragment.
// ---------------------------------------------------------------------------

/** Action keywords the models use (case-insensitive). */
const ACTION_RE = /\b(BUY|SELL|HOLD|买入|卖出|持有|看多|看空|做多|做空|增持|减持)\b/i

/**
 * Markers that introduce a conclusion section (heading or inline).
 * The regex is tested against each raw line; the rest of the paragraph after
 * the marker is the "reason" zone.
 */
const CONCLUSION_MARKERS: RegExp[] = [
  /FINAL\s+TRANSACTION\s+PROPOSAL/i,
  /Overall\s+Sentiment/i,
  /Recommendation/i,
  /结论/,
  /建议/,
  /最终.*(?:判断|决策|结论)/,
  /Investment\s+Stance/i,
  /Stance/i,
]

/**
 * Debate-style markers — stance + key argument.
 */
const DEBATE_MARKERS: RegExp[] = [
  /(?:I\s+(?:argue|believe|maintain|contend))/i,
  /(?:我(?:认为|主张|坚持))/,
  /(?:My\s+stance|Position)/i,
  /(?:立场|观点)/,
]

/**
 * Smart excerpt for speech bubbles.
 *
 * Instead of naïvely taking the first `max` characters (which is usually a
 * heading or preamble), this looks for the *conclusion* of a report — the
 * action call and its reason — so the bubble conveys the agent's bottom line.
 *
 * Fallback: when no conclusion marker is found the LAST meaningful paragraph
 * is used, because conclusions almost always come at the end.
 */
export function smartExcerpt(markdown: string, max: number): string {
  // Early-out for tiny / empty input.
  const stripped = stripMarkdown(markdown)
  if (stripped.length === 0) return ''

  // Split into lines on the *raw* markdown so markers survive.
  const rawLines = markdown.split(/\n/)

  // --- 1. Try conclusion markers -------------------------------------------
  for (const marker of CONCLUSION_MARKERS) {
    const idx = rawLines.findIndex((l) => marker.test(l))
    if (idx === -1) continue
    const para = collectParagraph(rawLines, idx)
    const result = formatConclusion(para, max)
    if (result) return result
  }

  // --- 2. Try debate markers -----------------------------------------------
  for (const marker of DEBATE_MARKERS) {
    const idx = rawLines.findIndex((l) => marker.test(l))
    if (idx === -1) continue
    const para = collectParagraph(rawLines, idx)
    const result = formatConclusion(para, max)
    if (result) return result
  }

  // --- 3. Fallback: last meaningful paragraph ------------------------------
  // Only bother when text is long enough that tail ≠ everything.
  if (stripped.length > max) {
    const lastPara = lastParagraph(rawLines)
    if (lastPara) return truncate(lastPara, max)
  }

  // --- 4. Absolute fallback — same as plain excerpt. -----------------------
  return truncate(stripped, max)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect the content paragraph around `start`.
 *
 * If the marker line is a heading (no useful content after the marker itself),
 * skip blank lines and grab the next non-blank paragraph.  Otherwise collect
 * from the marker line onward until a blank line.
 */
function collectParagraph(lines: string[], start: number): string {
  const buf: string[] = []
  let i = start
  const markerLine = lines[i].trim()

  // Check if the marker line itself contains content beyond the heading /
  // marker keyword (i.e. has text after stripping `## MARKER`).
  const markerStripped = stripMarkdown(markerLine)
  const isHeadingOnly = /^\s{0,3}#{1,6}\s+/.test(markerLine)
    ? !ACTION_RE.test(markerStripped) && markerStripped.split(/\s+/).length <= 4
    : false

  if (isHeadingOnly) {
    // Skip the heading line and any blank lines after it.
    i++
    while (i < lines.length && lines[i].trim() === '') i++
  }

  // Collect non-blank consecutive lines.
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '' && buf.length > 0) break
    if (trimmed !== '') buf.push(trimmed)
  }

  return stripMarkdown(buf.join(' '))
}

/**
 * Try to pull an action (BUY/SELL/HOLD/…) plus a compact reason from `para`.
 * Returns `null` if the paragraph is too short to be meaningful.
 */
function formatConclusion(para: string, max: number): string | null {
  if (para.length < 2) return null

  const actionMatch = para.match(ACTION_RE)
  if (actionMatch) {
    const action = actionMatch[0].toUpperCase()
    // Take everything after the action keyword as the reason.
    const afterAction = para.slice((actionMatch.index ?? 0) + actionMatch[0].length).trim()
    // Strip leading punctuation / connectors.
    const reason = afterAction.replace(/^[,，:：;；—\-\s]+/, '').trim()
    if (reason) {
      const full = `${action} — ${reason}`
      return truncate(full, max)
    }
    // Action alone still beats a random first line.
    return truncate(action, max)
  }

  // No action keyword — return the paragraph as-is (it's still from a
  // conclusion section, so better than the opening).
  return truncate(para, max)
}

/**
 * Extract the last meaningful paragraph from raw markdown lines.
 * Works on raw lines to preserve paragraph boundaries (blank-line separated).
 */
function lastParagraph(lines: string[]): string | null {
  // Walk backwards to find the last non-blank paragraph.
  let end = lines.length - 1
  // Skip trailing blank lines.
  while (end >= 0 && lines[end].trim() === '') end--
  if (end < 0) return null

  // Collect backwards until a blank line.
  const buf: string[] = []
  for (let i = end; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (trimmed === '') break
    buf.unshift(trimmed)
  }

  const text = stripMarkdown(buf.join(' '))
  return text.length > 0 ? text : null
}
