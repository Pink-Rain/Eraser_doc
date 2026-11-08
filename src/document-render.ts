import { DOCUMENT_WIDTH, type DocumentBackground, type DocumentContent, type DocumentFontKey, type DocumentRun, type DocumentZone } from "@/lib/document-model"

import { builtinBackgrounds, documentFonts } from "./document-assets"

/**
 * Le rendu d'un document : son fond et ses zones de texte dessinés dans un canvas, à la
 * manière du navigateur dans l'éditeur (même police, même coupure des lignes, même
 * alignement). C'est cette image que lisent les joueurs, que reçoit Roll20 et dont est fait
 * le PDF.
 */

/* ---------- polices embarquées ---------- */

let fontsReady: Promise<void> | null = null

/** Les polices des documents (assets/polices de l'extension), chargées une fois par page. */
export function loadDocumentFonts() {
  if (fontsReady) return fontsReady
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve()
  fontsReady = Promise.all(Object.values(documentFonts).flatMap((font) => {
    const name = /^"([^"]+)"/.exec(font.family)?.[1] ?? ""
    return font.files.map(async (file) => {
      try {
        const face = new FontFace(name, `url(${file.file}) format("woff2")`, { weight: String(file.weight), style: file.style, display: "swap" })
        document.fonts.add(await face.load())
      } catch { /* police absente : sa remplaçante prend la place */ }
    })
  })).then(() => undefined)
  return fontsReady
}

/* ---------- fond ---------- */

/** L'adresse du fond, lisible par un canvas (même origine : une adresse extérieure passe par le serveur local). */
export function backgroundSource(background: DocumentBackground, uploadedUrl: string) {
  if (background.kind === "builtin") return builtinBackgrounds[background.key].src
  if (background.kind === "upload") return uploadedUrl
  return `/api/tokens/source?url=${encodeURIComponent(background.url)}`
}

export function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("L’image de fond n’a pas pu être chargée."))
    image.src = source
  })
}

/* ---------- mise en page du texte ---------- */

export function zoneFont(zone: Pick<DocumentZone, "font">, run: Pick<DocumentRun, "bold" | "italic">, size: number) {
  return `${run.italic ? "italic " : ""}${run.bold ? "bold " : ""}${size}px ${documentFonts[zone.font as DocumentFontKey]?.family ?? documentFonts.fell.family}`
}

type Piece = { text: string; run: DocumentRun; width: number; space: boolean }
type Line = { pieces: Piece[]; width: number; spaces: number; soft: boolean }

/**
 * Coupe un paragraphe en lignes comme `white-space: pre-wrap` et `overflow-wrap: break-word` :
 * les espaces restent, ceux de fin de ligne ne comptent pas, un mot trop long pour une ligne
 * entière est coupé lettre à lettre.
 */
function layoutParagraph(context: CanvasRenderingContext2D, zone: DocumentZone, paragraph: DocumentRun[], maxWidth: number, size: number): Line[] {
  const lines: Line[] = []
  let line: Line = { pieces: [], width: 0, spaces: 0, soft: false }
  const measure = (text: string, run: DocumentRun) => {
    context.font = zoneFont(zone, run, size)
    return context.measureText(text).width
  }
  // La largeur sans les espaces de fin (ils « pendent » hors de la ligne, comme dans le navigateur).
  const visibleWidth = (pieces: Piece[]) => {
    let end = pieces.length
    while (end > 0 && pieces[end - 1].space) end -= 1
    return pieces.slice(0, end).reduce((total, piece) => total + piece.width, 0)
  }
  const close = (soft: boolean) => {
    let end = line.pieces.length
    while (end > 0 && line.pieces[end - 1].space) end -= 1
    const kept = line.pieces.slice(0, end)
    lines.push({ pieces: kept, width: visibleWidth(kept), spaces: kept.filter((piece) => piece.space).length, soft })
    line = { pieces: [], width: 0, spaces: 0, soft: false }
  }
  const add = (piece: Piece) => { line.pieces.push(piece); line.width += piece.width }
  for (const run of paragraph) {
    const parts = run.text.split(/(\n| +)/).filter((part) => part.length)
    for (const part of parts) {
      if (part === "\n") { close(false); continue }
      if (part.startsWith(" ")) { add({ text: part, run, width: measure(part, run), space: true }); continue }
      const width = measure(part, run)
      const fits = width <= maxWidth + 0.5
      if (line.width + width <= maxWidth + 0.5) { add({ text: part, run, width, space: false }); continue }
      // Le mot ne tient plus : il passe à la ligne (une ligne qui n'avait que des espaces les garde).
      if (line.pieces.length) close(true)
      if (fits) add({ text: part, run, width, space: false })
      else breakWord(part, run)
    }
  }
  close(false)
  return lines

  function breakWord(word: string, run: DocumentRun) {
    let chunk = ""
    for (const char of word) {
      const next = chunk + char
      if (chunk && line.width + measure(next, run) > maxWidth + 0.5) {
        add({ text: chunk, run, width: measure(chunk, run), space: false })
        close(true)
        chunk = char
      } else chunk = next
    }
    if (chunk) add({ text: chunk, run, width: measure(chunk, run), space: false })
  }
}

/** Dessine une zone ; `scale` : pixels du canvas par unité du document. */
export function drawZone(context: CanvasRenderingContext2D, zone: DocumentZone, scale: number) {
  const size = zone.size * scale
  const width = zone.width * scale
  const height = zone.height * scale
  const lineHeight = size * zone.lineHeight
  context.save()
  context.translate((zone.x + zone.width / 2) * scale, (zone.y + zone.height / 2) * scale)
  context.rotate((zone.rotation * Math.PI) / 180)
  context.translate(-width / 2, -height / 2)
  context.globalAlpha = zone.opacity
  context.globalCompositeOperation = zone.ink ? "multiply" : "source-over"
  context.textBaseline = "alphabetic"
  const spacing = zone.letterSpacing * scale
  if ("letterSpacing" in context) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`
  const lines = zone.paragraphs.flatMap((paragraph) => paragraph.length ? layoutParagraph(context, zone, paragraph, width, size) : [{ pieces: [], width: 0, spaces: 0, soft: false } as Line])
  const total = lines.length * lineHeight
  const top = zone.valign === "middle" ? (height - total) / 2 : zone.valign === "bottom" ? height - total : 0
  // La ligne de base dans sa ligne, comme le navigateur : l'interligne partagé au-dessus et au-dessous.
  context.font = zoneFont(zone, {}, size)
  const metrics = context.measureText("Hg")
  const ascent = metrics.fontBoundingBoxAscent || size * 0.8
  const descent = metrics.fontBoundingBoxDescent || size * 0.2
  const baseline = (lineHeight - (ascent + descent)) / 2 + ascent
  lines.forEach((line, index) => {
    const extra = width - line.width
    const justify = zone.align === "justify" && line.soft && line.spaces > 0 && extra > 0
    let x = zone.align === "center" ? extra / 2 : zone.align === "right" ? extra : 0
    const y = top + index * lineHeight + baseline
    for (const piece of line.pieces) {
      const pieceWidth = piece.width + (justify && piece.space ? extra / line.spaces : 0)
      if (!piece.space || piece.run.underline || piece.run.strike) {
        context.fillStyle = piece.run.color || zone.color
        context.font = zoneFont(zone, piece.run, size)
        if (!piece.space) context.fillText(piece.text, x, y)
        const thickness = Math.max(1, size * 0.055)
        if (piece.run.underline) context.fillRect(x, y + size * 0.1, pieceWidth, thickness)
        if (piece.run.strike) context.fillRect(x, y - ascent * 0.3, pieceWidth, thickness)
      }
      x += pieceWidth
    }
  })
  context.restore()
}

/**
 * Le document entier dans un canvas de `width` pixels de large. `paper` : la couleur posée
 * sous le fond (blanc pour l'impression), transparent sinon.
 */
export async function renderDocumentCanvas(content: DocumentContent, background: HTMLImageElement | null, width: number, paper = "") {
  await loadDocumentFonts()
  const scale = width / DOCUMENT_WIDTH
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width)
  canvas.height = Math.round(content.height * scale)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Le navigateur ne peut pas dessiner le document.")
  if (paper) { context.fillStyle = paper; context.fillRect(0, 0, canvas.width, canvas.height) }
  if (background) context.drawImage(background, 0, 0, canvas.width, canvas.height)
  // Les polices utilisées, chargées avant de dessiner (sinon le canvas prend la remplaçante).
  await Promise.all(content.zones.flatMap((zone) => [zoneFont(zone, {}, zone.size), zoneFont(zone, { bold: true }, zone.size), zoneFont(zone, { italic: true }, zone.size)].map((font) => document.fonts.load(font).catch(() => []))))
  for (const zone of content.zones) drawZone(context, zone, scale)
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Le document n’a pas pu être préparé.")), type, quality))
}
