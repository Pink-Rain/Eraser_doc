import { DOCUMENT_WIDTH, type DocumentBackground, type DocumentContent, type DocumentFontKey, type DocumentLine, type DocumentPicture, type DocumentRun, type DocumentShape, type DocumentZone } from "@/lib/document-model"

import { builtinBackgrounds, documentFonts, libraryBackgroundUrl } from "./document-assets"
import { blendCanvas, lineCap, lineDash, metalStops, orderedElements, reliefShadows, shapeGradient, shapePath, withAlpha, zoneBlend } from "./document-elements"

/**
 * Le rendu d'un document : son fond, puis ses éléments dans l'ordre des calques (zones de texte,
 * lignes, formes, images, calques de dessin), chacun avec son mode de fusion, dessinés dans un canvas à la
 * manière du navigateur dans l'éditeur (même police, même coupure des lignes, même alignement,
 * mêmes pointillés). C'est cette image que lisent les joueurs, que reçoit Roll20 et dont est fait
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
  if (background.kind === "library") return libraryBackgroundUrl(background.id)
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

type ZoneLayout = { size: number; width: number; height: number; lineHeight: number; lines: Line[]; top: number; ascent: number; baseline: number }

/**
 * Prépare le dessin d'une zone dans `context` : le repère de la zone (centre, inclinaison, coin
 * haut gauche), l'espacement des lettres, et la coupure de ses lignes.
 */
function prepareZone(context: CanvasRenderingContext2D, zone: DocumentZone, scale: number): ZoneLayout {
  const size = zone.size * scale
  const width = zone.width * scale
  const height = zone.height * scale
  const lineHeight = size * zone.lineHeight
  context.translate((zone.x + zone.width / 2) * scale, (zone.y + zone.height / 2) * scale)
  context.rotate((zone.rotation * Math.PI) / 180)
  context.translate(-width / 2, -height / 2)
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
  return { size, width, height, lineHeight, lines, top, ascent, baseline }
}

/**
 * Dessine les lignes d'une zone préparée. `fill` : la couleur (ou le dégradé) de chaque ligne,
 * sinon l'encre de chaque morceau ; `decorations` : souligné et barré.
 */
function paintZoneLines(context: CanvasRenderingContext2D, zone: DocumentZone, layout: ZoneLayout, fill: ((line: number) => string | CanvasGradient) | null, decorations: boolean) {
  const { size, width, lineHeight, lines, top, ascent, baseline } = layout
  lines.forEach((line, index) => {
    const extra = width - line.width
    const justify = zone.align === "justify" && line.soft && line.spaces > 0 && extra > 0
    let x = zone.align === "center" ? extra / 2 : zone.align === "right" ? extra : 0
    const y = top + index * lineHeight + baseline
    for (const piece of line.pieces) {
      const pieceWidth = piece.width + (justify && piece.space ? extra / line.spaces : 0)
      if (!piece.space || (decorations && (piece.run.underline || piece.run.strike))) {
        context.font = zoneFont(zone, piece.run, size)
        context.fillStyle = fill ? fill(index) : piece.run.color || zone.color
        if (!piece.space) context.fillText(piece.text, x, y)
        if (decorations) {
          // Souligné et barré : dans l'encre du morceau, même sur un texte métallisé (comme la scène).
          context.fillStyle = piece.run.color || zone.color
          const thickness = Math.max(1, size * 0.055)
          if (piece.run.underline) context.fillRect(x, y + size * 0.1, pieceWidth, thickness)
          if (piece.run.strike) context.fillRect(x, y - ascent * 0.3, pieceWidth, thickness)
        }
      }
      x += pieceWidth
    }
  })
}

/** Dessine une zone ; `scale` : pixels du canvas par unité du document. */
export function drawZone(context: CanvasRenderingContext2D, zone: DocumentZone, scale: number) {
  if (zone.relief || zone.metal) { drawZoneWithEffects(context, zone, scale); return }
  context.save()
  context.globalAlpha = zone.opacity
  context.globalCompositeOperation = blendCanvas(zoneBlend(zone))
  const layout = prepareZone(context, zone, scale)
  paintZoneLines(context, zone, layout, null, true)
  context.restore()
}

let effectLayer: HTMLCanvasElement | null = null
let glyphLayer: HTMLCanvasElement | null = null

/** Une toile de travail de la taille du rendu, vidée. */
function scratch(canvas: HTMLCanvasElement | null, width: number, height: number) {
  const next = canvas ?? document.createElement("canvas")
  if (next.width !== width || next.height !== height) { next.width = width; next.height = height }
  const context = next.getContext("2d")
  if (!context) throw new Error("Le navigateur ne peut pas dessiner le document.")
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, width, height)
  context.globalAlpha = 1
  context.globalCompositeOperation = "source-over"
  context.filter = "none"
  return { canvas: next, context }
}

/**
 * Une zone en relief ou métallisée, dessinée à part puis fondue d'un seul tenant (comme la scène,
 * où lumière, ombres et texte sont un même bloc) : d'abord la lumière et les ombres du relief (les
 * lettres, floutées et décalées, de la plus basse à la plus haute), puis le texte lui-même, dans
 * son encre ou dans le dégradé de son métal, recommencé à chaque ligne.
 */
function drawZoneWithEffects(context: CanvasRenderingContext2D, zone: DocumentZone, scale: number) {
  const { width, height } = context.canvas
  const effects = scratch(effectLayer, width, height)
  effectLayer = effects.canvas
  const layer = effects.context
  const angle = (zone.rotation * Math.PI) / 180
  for (const shadow of [...reliefShadows(zone)].reverse()) {
    // Les lettres de l'ombre, pleines, sur leur propre toile ; floutées et décalées en la posant.
    const glyphs = scratch(glyphLayer, width, height)
    glyphLayer = glyphs.canvas
    glyphs.context.save()
    const layout = prepareZone(glyphs.context, zone, scale)
    paintZoneLines(glyphs.context, zone, layout, () => shadow.color, false)
    glyphs.context.restore()
    // Le décalage suit l'inclinaison de la zone (le `text-shadow` de la scène tourne avec elle).
    const dx = (shadow.x * Math.cos(angle) - shadow.y * Math.sin(angle)) * scale
    const dy = (shadow.x * Math.sin(angle) + shadow.y * Math.cos(angle)) * scale
    layer.save()
    layer.globalAlpha = shadow.alpha
    // Le flou de `text-shadow` (son rayon) vaut deux écarts types : `blur()` prend l'écart type.
    if (shadow.blur > 0) layer.filter = `blur(${(shadow.blur * scale) / 2}px)`
    layer.drawImage(glyphs.canvas, dx, dy)
    layer.restore()
  }
  layer.save()
  const layout = prepareZone(layer, zone, scale)
  const stops = metalStops(zone.metal)
  const gradients = new Map<number, CanvasGradient>()
  const metal = stops.length ? (line: number) => {
    let gradient = gradients.get(line)
    if (!gradient) {
      const lineTop = layout.top + line * layout.lineHeight
      gradient = layer.createLinearGradient(0, lineTop, 0, lineTop + layout.lineHeight)
      for (const [offset, color] of stops) gradient.addColorStop(offset, color)
      gradients.set(line, gradient)
    }
    return gradient
  } : null
  paintZoneLines(layer, zone, layout, metal, true)
  layer.restore()
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = zone.opacity
  context.globalCompositeOperation = blendCanvas(zoneBlend(zone))
  context.drawImage(effects.canvas, 0, 0)
  context.restore()
}

/** Dessine une ligne droite (mêmes tirets et mêmes bouts que dans l'éditeur). */
export function drawLine(context: CanvasRenderingContext2D, line: DocumentLine, scale: number) {
  context.save()
  context.globalAlpha = line.opacity
  context.globalCompositeOperation = blendCanvas(line.blend)
  context.strokeStyle = line.color
  context.lineWidth = line.width * scale
  context.lineCap = lineCap(line.style)
  context.setLineDash(lineDash(line.style, line.width * scale))
  context.beginPath()
  context.moveTo(line.x1 * scale, line.y1 * scale)
  context.lineTo(line.x2 * scale, line.y2 * scale)
  context.stroke()
  context.restore()
}

let shapeLayer: HTMLCanvasElement | null = null

/**
 * Dessine une forme : remplissage puis contour, d'abord à part, puis posés d'un seul tenant avec
 * l'opacité et le mode de fusion de la forme (comme le navigateur fond le SVG de l'éditeur).
 */
export function drawShape(context: CanvasRenderingContext2D, shape: DocumentShape, scale: number) {
  shapeLayer ??= document.createElement("canvas")
  const { width, height } = context.canvas
  if (shapeLayer.width !== width || shapeLayer.height !== height) { shapeLayer.width = width; shapeLayer.height = height }
  const layer = shapeLayer.getContext("2d")
  if (!layer) return
  layer.setTransform(1, 0, 0, 1, 0, 0)
  layer.clearRect(0, 0, width, height)
  layer.translate((shape.x + shape.width / 2) * scale, (shape.y + shape.height / 2) * scale)
  layer.rotate((shape.rotation * Math.PI) / 180)
  layer.scale(scale, scale)
  layer.translate(-shape.width / 2, -shape.height / 2)
  const path = new Path2D(shapePath(shape))
  if (shape.fill === "solid") {
    layer.fillStyle = shape.fillColor
    layer.fill(path)
  } else if (shape.fill !== "none") {
    const geometry = shapeGradient(shape)
    const gradient = geometry.kind === "radial"
      ? layer.createRadialGradient(geometry.cx, geometry.cy, 0, geometry.cx, geometry.cy, geometry.r)
      : layer.createLinearGradient(geometry.x1, geometry.y1, geometry.x2, geometry.y2)
    gradient.addColorStop(0, shape.fillColor)
    gradient.addColorStop(1, withAlpha(shape.fillColor2, shape.fillOpacity2))
    layer.fillStyle = gradient
    layer.fill(path)
  }
  if (shape.strokeWidth > 0) {
    layer.strokeStyle = shape.strokeColor
    layer.lineWidth = shape.strokeWidth
    layer.lineJoin = "round"
    layer.lineCap = lineCap(shape.strokeStyle)
    layer.setLineDash(lineDash(shape.strokeStyle, shape.strokeWidth))
    layer.stroke(path)
  }
  context.save()
  context.globalAlpha = shape.opacity
  context.globalCompositeOperation = blendCanvas(shape.blend)
  context.drawImage(shapeLayer, 0, 0)
  context.restore()
}

/** Dessine une image posée ou un calque de dessin, à sa place et à son inclinaison. */
export function drawPicture(context: CanvasRenderingContext2D, picture: DocumentPicture, image: CanvasImageSource, scale: number) {
  context.save()
  context.translate((picture.x + picture.width / 2) * scale, (picture.y + picture.height / 2) * scale)
  context.rotate((picture.rotation * Math.PI) / 180)
  context.globalAlpha = picture.opacity
  context.globalCompositeOperation = blendCanvas(picture.blend)
  context.imageSmoothingQuality = "high"
  context.drawImage(image, (-picture.width / 2) * scale, (-picture.height / 2) * scale, picture.width * scale, picture.height * scale)
  context.restore()
}

/**
 * Le document entier dans un canvas de `width` pixels de large. `paper` : la couleur posée
 * sous le fond (blanc pour l'impression), transparent sinon. `pictures` : les images des
 * pièces (images posées, calques de dessin aplatis), par nom ; une pièce absente n'est pas dessinée.
 */
export async function renderDocumentCanvas(content: DocumentContent, background: HTMLImageElement | null, width: number, paper = "", pictures: ReadonlyMap<string, CanvasImageSource> = new Map()) {
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
  for (const element of orderedElements(content)) {
    if (element.kind === "zone") drawZone(context, element.zone, scale)
    else if (element.kind === "line") drawLine(context, element.line, scale)
    else if (element.kind === "shape") drawShape(context, element.shape, scale)
    else {
      const image = pictures.get(element.picture.asset)
      if (image) drawPicture(context, element.picture, image, scale)
    }
  }
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Le document n’a pas pu être préparé.")), type, quality))
}
