import { mergeRuns, type DocumentParagraph, type DocumentRun } from "@/lib/document-model"

/**
 * Le texte d'une zone de document, entre la zone modifiable du navigateur (HTML) et le
 * document enregistré (paragraphes de morceaux stylés). Seuls le gras, l'italique, le
 * souligné, le barré, la couleur et les retours à la ligne passent : c'est tout ce que le
 * rendu (src/document-render.ts) sait dessiner.
 */

type RunStyle = Omit<DocumentRun, "text">

const BLOCKS = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL"])

function hexOf(color: string) {
  const value = color.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${value.slice(1).split("").map((digit) => digit + digit).join("")}`
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value)
  if (rgb) return `#${rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`
  return ""
}

function styleOf(element: HTMLElement, inherited: RunStyle): RunStyle {
  const style: RunStyle = { ...inherited }
  const tag = element.tagName
  if (tag === "B" || tag === "STRONG") style.bold = true
  if (tag === "I" || tag === "EM") style.italic = true
  if (tag === "U") style.underline = true
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") style.strike = true
  if (tag === "FONT" && element.getAttribute("color")) style.color = hexOf(element.getAttribute("color") || "") || style.color
  const css = element.style
  if (css.fontWeight) style.bold = css.fontWeight === "bold" || css.fontWeight === "bolder" || Number(css.fontWeight) >= 600
  if (css.fontStyle) style.italic = /italic|oblique/.test(css.fontStyle)
  const decoration = `${css.textDecorationLine || ""} ${css.textDecoration || ""}`
  if (/underline/.test(decoration)) style.underline = true
  if (/line-through/.test(decoration)) style.strike = true
  if (css.color) style.color = hexOf(css.color) || style.color
  return style
}

/** Le dernier nœud utile d'un bloc (le `<br>` de fin que le navigateur pose pour garder la ligne). */
function isTrailingBreak(node: Node, root: HTMLElement) {
  let current: Node | null = node
  while (current && current !== root) {
    let next = current.nextSibling
    while (next && next.nodeType === Node.TEXT_NODE && !next.textContent) next = next.nextSibling
    if (next) return false
    const parent: Node | null = current.parentNode
    if (parent instanceof HTMLElement && BLOCKS.has(parent.tagName)) return true
    current = parent
  }
  return true
}

/** Les paragraphes d'une zone modifiable : un bloc (`<div>`) par paragraphe, `<br>` pour un retour à la ligne. */
export function paragraphsFromElement(root: HTMLElement): DocumentParagraph[] {
  const paragraphs: DocumentRun[][] = [[]]
  let needNew = false
  const current = () => paragraphs[paragraphs.length - 1]
  const push = (text: string, style: RunStyle) => {
    if (needNew) { paragraphs.push([]); needNew = false }
    const clean: DocumentRun = { text }
    if (style.bold) clean.bold = true
    if (style.italic) clean.italic = true
    if (style.underline) clean.underline = true
    if (style.strike) clean.strike = true
    if (style.color) clean.color = style.color
    current().push(clean)
  }
  const visit = (node: Node, style: RunStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").replace(/ /g, " ").replace(/​/g, "")
      if (text) push(text, style)
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === "BR") {
      if (!isTrailingBreak(node, root)) push("\n", style)
      return
    }
    const block = BLOCKS.has(node.tagName)
    if (block && (needNew || current().length)) { paragraphs.push([]); needNew = false }
    const inner = styleOf(node, style)
    for (const child of node.childNodes) visit(child, inner)
    if (block) needNew = true
  }
  for (const child of root.childNodes) visit(child, {})
  return paragraphs.map((paragraph) => mergeRuns(paragraph))
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function runHtml(run: DocumentRun) {
  let html = escape(run.text).replace(/\n/g, "<br>")
  if (run.strike) html = `<s>${html}</s>`
  if (run.underline) html = `<u>${html}</u>`
  if (run.italic) html = `<i>${html}</i>`
  if (run.bold) html = `<b>${html}</b>`
  if (run.color) html = `<font color="${run.color}">${html}</font>`
  return html
}

/** Le HTML posé dans la zone modifiable : un `<div>` par paragraphe (vide : `<div><br></div>`). */
export function paragraphsToHtml(paragraphs: DocumentParagraph[]) {
  return paragraphs.map((paragraph) => {
    const html = paragraph.map(runHtml).join("")
    if (!html) return "<div><br></div>"
    // Un retour à la ligne en fin de paragraphe : le navigateur montre la ligne vide avec un second <br>.
    return `<div>${html}${paragraph.at(-1)?.text.endsWith("\n") ? "<br>" : ""}</div>`
  }).join("")
}

export function paragraphsAreEmpty(paragraphs: DocumentParagraph[]) {
  return !paragraphs.some((paragraph) => paragraph.some((run) => run.text.trim()))
}
