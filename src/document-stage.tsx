import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { Move, RotateCw } from "lucide-react"

import { DOCUMENT_WIDTH, type DocumentContent, type DocumentLine, type DocumentParagraph, type DocumentPicture, type DocumentShape, type DocumentZone } from "@/lib/document-model"
import { cn } from "@/lib/utils"

import { documentFonts } from "./document-assets"
import {
  DRAWING_SCALE, blendCss, documentToPicture, lineCap, lineDash, orderedElements, paintStroke, paintStrokes, shapeGradient, shapePath, zoneBlend,
  type Paint, type Stroke,
} from "./document-elements"
import { paragraphsAreEmpty, paragraphsFromElement, paragraphsToHtml } from "./document-text"

/**
 * La scène de l'éditeur de documents : le fond à la taille de l'écran et, dans l'ordre des
 * calques, les zones de texte, les lignes, les images et les calques de dessin, chacun avec son
 * mode de fusion (comme le rendu, src/document-render.ts).
 *
 * Outil « sélection » : un élément se choisit d'un clic (une zone de texte : on écrit aussitôt
 * dedans), se déplace par son cadre ou sa poignée, se redimensionne par ses coins et ses côtés,
 * s'incline par la poignée ronde (Maj : par pas de 15°) ; une ligne se déplace et s'allonge par
 * ses bouts ; un calque de dessin se choisit en cliquant sur son encre. Tracer un rectangle sur le
 * fond crée une zone. Outil « ligne » : tracer la ligne (Maj : par pas de 15°). Outil « forme » :
 * tracer sa boîte (Maj : carré ou cercle). Outils « plume » et
 * « gomme » : dessiner dans le calque de dessin choisi (la plume en crée un s'il n'y en a pas).
 *
 * Tout est mesuré en unités du document (largeur 1000) : la scène est simplement agrandie ou
 * réduite d'un facteur, comme le rendu.
 */

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
/** Ce qui se déplace, se redimensionne et s'incline : une zone de texte, une forme ou une image. */
type Box = Pick<DocumentZone, "x" | "y" | "width" | "height" | "rotation">
type Pixels = { width: number; height: number }
type Gesture =
  | { kind: "move"; id: string; start: Point; origin: Box; moved: boolean; focusOnClick: Point | null }
  | { kind: "resize"; id: string; start: Point; origin: Box; moved: boolean; handle: readonly [number, number]; keepRatio: "image" | "shift" | "none" }
  | { kind: "rotate"; id: string; start: Point; origin: Box; moved: boolean }
  | { kind: "draw"; start: Point; moved: boolean }
  | { kind: "line-move"; id: string; start: Point; origin: DocumentLine; moved: boolean }
  | { kind: "line-end"; id: string; start: Point; origin: DocumentLine; end: 1 | 2; moved: boolean }
  | { kind: "line-new"; start: Point; moved: boolean }
  | { kind: "shape-new"; start: Point; moved: boolean }
  | { kind: "paint"; start: Point; moved: boolean; target: string | null; geometry: Box; pixels: Pixels; stroke: Stroke; canvas: HTMLCanvasElement | null; pen: boolean }

export type StageTool = "select" | "line" | "shape" | "brush" | "eraser"
/** La plume (taille en unités du document) et la gomme. */
export type BrushSettings = { size: number; color: string; opacity: number; nib: number; angle: number; eraserSize: number }
export type LineSettings = Pick<DocumentLine, "width" | "color" | "style" | "opacity" | "blend">
export type ShapeSettings = Omit<DocumentShape, "id" | "x" | "y" | "width" | "height" | "rotation">

const MIN_WIDTH = 30
const MIN_HEIGHT = 16
const MIN_PICTURE = 12
const handles = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]] as const
const handleCursor = (sx: number, sy: number) => sx === 0 ? "ns-resize" : sy === 0 ? "ew-resize" : sx === sy ? "nwse-resize" : "nesw-resize"

export function zoneTextStyle(zone: DocumentZone) {
  return {
    fontFamily: documentFonts[zone.font].family,
    fontSize: zone.size,
    lineHeight: zone.lineHeight,
    letterSpacing: zone.letterSpacing,
    color: zone.color,
    textAlign: zone.align,
  } as const
}

/** La zone modifiable d'une zone de la scène (pour la mise en forme de la barre d'outils). */
export function zoneEditable(id: string) {
  return document.querySelector<HTMLElement>(`[data-document-zone="${CSS.escape(id)}"] [role="textbox"]`)
}

/** Place le curseur à l'endroit cliqué dans une zone de texte (ou à la fin). */
export function focusAt(element: HTMLElement, client: Point | null) {
  element.focus({ preventScroll: true })
  const selection = window.getSelection()
  if (!selection) return
  let range: Range | null = null
  if (client) {
    const position = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(client.x, client.y)
    if (position && element.contains(position.offsetNode)) {
      range = document.createRange()
      range.setStart(position.offsetNode, position.offset)
      range.collapse(true)
    } else {
      const legacy = document.caretRangeFromPoint?.(client.x, client.y)
      if (legacy && element.contains(legacy.startContainer)) range = legacy
    }
  }
  if (!range) {
    range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

function ZoneText({ zone, selected, interactive, onPointerDown, onText, onFocus, onBlur, onOverflow }: {
  zone: DocumentZone
  selected: boolean
  interactive: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onText: (paragraphs: DocumentParagraph[]) => void
  onFocus: () => void
  onBlur: () => void
  onOverflow: (overflowing: boolean) => void
}) {
  const editable = useRef<HTMLDivElement>(null)
  const empty = paragraphsAreEmpty(zone.paragraphs)
  const [initial] = useState(() => paragraphsToHtml(zone.paragraphs))
  const report = useRef(onOverflow)
  useEffect(() => { report.current = onOverflow })

  // Le texte appartient au navigateur : posé une seule fois (une modification venue d'ailleurs,
  // annuler par exemple, remonte la zone avec une nouvelle clé).
  useEffect(() => {
    if (editable.current) editable.current.innerHTML = initial
  }, [initial])

  // Le texte qui dépasse de sa zone est signalé (le rendu le dessine aussi, hors du cadre).
  const height = zone.height
  useEffect(() => {
    const element = editable.current
    if (!element || typeof ResizeObserver === "undefined") return
    const check = () => report.current(element.offsetHeight > height + 1)
    const observer = new ResizeObserver(check)
    observer.observe(element)
    check()
    return () => observer.disconnect()
  }, [height])

  function paste(event: ReactClipboardEvent<HTMLDivElement>) {
    // Seul le texte est collé : une mise en forme venue d'ailleurs ne se dessinerait pas au rendu.
    event.preventDefault()
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"))
  }

  return <div
    data-document-zone={zone.id}
    onPointerDown={onPointerDown}
    className={cn("absolute flex flex-col", zone.valign === "middle" ? "justify-center" : zone.valign === "bottom" ? "justify-end" : "justify-start", !interactive ? "pointer-events-none" : selected ? "cursor-text" : "cursor-pointer")}
    style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height, transform: `rotate(${zone.rotation}deg)`, opacity: zone.opacity, mixBlendMode: blendCss(zoneBlend(zone)) }}
  >
    <div
      ref={editable}
      contentEditable={selected && interactive}
      suppressContentEditableWarning
      spellCheck
      lang="fr"
      role="textbox"
      aria-multiline="true"
      aria-label="Texte de la zone"
      onInput={(event) => onText(paragraphsFromElement(event.currentTarget))}
      onFocus={onFocus}
      onBlur={onBlur}
      onPaste={paste}
      onDrop={(event) => event.preventDefault()}
      className="w-full select-text whitespace-pre-wrap break-words outline-none [overflow-wrap:break-word]"
      style={zoneTextStyle(zone)}
    />
    {empty && !selected && <span className="pointer-events-none absolute inset-0 grid place-items-center text-center font-sans text-[18px] italic text-black/35">Zone vide — clique pour écrire</span>}
  </div>
}

/** Une ligne droite : le trait visible, et une bande plus large, invisible, pour la saisir. */
function LineView({ line, height, interactive, scale, onPointerDown }: { line: DocumentLine; height: number; interactive: boolean; scale: number; onPointerDown: (event: ReactPointerEvent<SVGLineElement>) => void }) {
  return <svg
    data-document-line={line.id}
    className="pointer-events-none absolute left-0 top-0 overflow-visible"
    width={DOCUMENT_WIDTH}
    height={height}
    style={{ opacity: line.opacity, mixBlendMode: blendCss(line.blend) }}
  >
    <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.color} strokeWidth={line.width} strokeLinecap={lineCap(line.style)} strokeDasharray={lineDash(line.style, line.width).join(" ") || undefined} />
    <line
      x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
      stroke="transparent"
      strokeWidth={Math.max(line.width, 14 / scale)}
      strokeLinecap="round"
      className={interactive ? "cursor-move" : undefined}
      style={{ pointerEvents: interactive ? "stroke" : "none" }}
      onPointerDown={onPointerDown}
    />
  </svg>
}

const boxStyle = (box: Box) => ({ left: box.x, top: box.y, width: box.width, height: box.height, transform: `rotate(${box.rotation}deg)` })

/**
 * Une forme : son remplissage (uni ou dégradé) et son contour, en SVG, fondus d'un seul tenant avec
 * ce qui est dessous. On la saisit par son contour, et par son intérieur quand elle est remplie.
 */
function ShapeView({ shape, interactive, scale, onPointerDown }: { shape: DocumentShape; interactive: boolean; scale: number; onPointerDown: (event: ReactPointerEvent<SVGPathElement>) => void }) {
  const path = shapePath(shape)
  const gradientId = `forme-${shape.id}`
  const gradient = shape.fill === "linear" || shape.fill === "radial" ? shapeGradient(shape) : null
  const stops = <>
    <stop offset="0" stopColor={shape.fillColor} />
    <stop offset="1" stopColor={shape.fillColor2} stopOpacity={shape.fillOpacity2} />
  </>
  return <svg
    data-document-shape={shape.id}
    className="pointer-events-none absolute overflow-visible"
    width={shape.width}
    height={shape.height}
    style={{ ...boxStyle(shape), opacity: shape.opacity, mixBlendMode: blendCss(shape.blend) }}
  >
    {gradient && <defs>
      {gradient.kind === "radial"
        ? <radialGradient id={gradientId} gradientUnits="userSpaceOnUse" cx={gradient.cx} cy={gradient.cy} r={gradient.r}>{stops}</radialGradient>
        : <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={gradient.x1} y1={gradient.y1} x2={gradient.x2} y2={gradient.y2}>{stops}</linearGradient>}
    </defs>}
    <path
      d={path}
      fill={shape.fill === "none" ? "none" : shape.fill === "solid" ? shape.fillColor : `url(#${gradientId})`}
      stroke={shape.strokeWidth > 0 ? shape.strokeColor : "none"}
      strokeWidth={shape.strokeWidth}
      strokeLinejoin="round"
      strokeLinecap={lineCap(shape.strokeStyle)}
      strokeDasharray={shape.strokeWidth > 0 ? lineDash(shape.strokeStyle, shape.strokeWidth).join(" ") || undefined : undefined}
    />
    <path
      d={path}
      fill={shape.fill === "none" ? "none" : "transparent"}
      stroke="transparent"
      strokeWidth={Math.max(shape.strokeWidth, 12 / scale)}
      className={interactive ? "cursor-move" : undefined}
      style={{ pointerEvents: interactive ? "painted" : "none" }}
      onPointerDown={onPointerDown}
    />
  </svg>
}

/** Une image posée sur le document. */
function PictureImage({ picture, src, interactive, onPointerDown }: { picture: DocumentPicture; src: string; interactive: boolean; onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void }) {
  return <div
    data-document-picture={picture.id}
    onPointerDown={onPointerDown}
    className={cn("absolute", interactive ? "cursor-move" : "pointer-events-none")}
    style={{ ...boxStyle(picture), opacity: picture.opacity, mixBlendMode: blendCss(picture.blend) }}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {src ? <img src={src} alt="" draggable={false} className="pointer-events-none size-full select-none" /> : <div className="grid size-full place-items-center bg-black/5 text-xs text-black/40">Image</div>}
  </div>
}

/**
 * Un calque de dessin : son image d'avant (s'il a été enregistré), ses nouveaux coups de plume, et
 * par-dessus le coup en train d'être tracé (dessiné directement par la scène, sans rendu de React).
 */
function DrawingLayer({ picture, src, paint }: { picture: DocumentPicture; src: string; paint: Paint | undefined }) {
  const committed = useRef<HTMLCanvasElement>(null)
  const live = useRef<HTMLCanvasElement>(null)
  const [base, setBase] = useState<{ src: string; image: HTMLImageElement } | null>(null)
  const drawn = useRef<{ base: HTMLImageElement | null; strokes: Stroke[]; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!src) return
    let alive = true
    const image = new Image()
    image.decoding = "async"
    image.onload = () => { if (alive) setBase({ src, image }) }
    image.src = src
    return () => { alive = false }
  }, [src])

  // Une nouvelle image (le calque aplati à l'enregistrement) : l'ancienne reste affichée jusqu'à ce
  // qu'elle soit lue, sans clignoter.
  const ready = !src || base?.src === src
  const loaded = src && base ? base.image : null
  const width = Math.round(paint?.width ?? (loaded ? loaded.naturalWidth : picture.width * DRAWING_SCALE))
  const height = Math.round(paint?.height ?? (loaded ? loaded.naturalHeight : picture.height * DRAWING_SCALE))

  // Le calque se redessine en entier quand son image ou ses coups changent ; un coup ajouté au bout
  // est seulement dessiné par-dessus.
  useEffect(() => {
    const canvas = committed.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context || !ready) return
    const strokes = paint?.strokes ?? []
    const previous = drawn.current
    const appended = previous && previous.base === loaded && previous.width === width && previous.height === height
      && previous.strokes.length <= strokes.length && previous.strokes.every((stroke, index) => strokes[index] === stroke)
    if (appended) paintStrokes(context, strokes.slice(previous.strokes.length))
    else {
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (loaded) context.drawImage(loaded, 0, 0, canvas.width, canvas.height)
      paintStrokes(context, strokes)
    }
    drawn.current = { base: loaded, strokes, width, height }
    // Le coup en direct est maintenant dans le calque.
    const liveCanvas = live.current
    liveCanvas?.getContext("2d")?.clearRect(0, 0, liveCanvas.width, liveCanvas.height)
  }, [ready, loaded, paint, width, height])

  return <div
    data-document-drawing={picture.id}
    className="pointer-events-none absolute"
    style={{ ...boxStyle(picture), opacity: picture.opacity, mixBlendMode: blendCss(picture.blend) }}
  >
    <canvas ref={committed} data-committed width={width} height={height} className="absolute inset-0 size-full" />
    <canvas ref={live} data-live width={width} height={height} className="absolute inset-0 size-full" />
  </div>
}

/** Le canvas d'un calque de dessin dans la scène. */
const drawingCanvas = (root: HTMLElement | null, id: string, which: "committed" | "live") =>
  root?.querySelector<HTMLCanvasElement>(`[data-document-drawing="${CSS.escape(id)}"] canvas[data-${which}]`) ?? null

export function DocumentStage({
  content, backgroundSrc, selectedId, contentKeys, showFrames, scale, tool, brush, lineSettings, shapeSettings, paint, pictureSrc,
  onScale, onSelect, onZoneChange, onPictureChange, onShapeChange, onLineChange, onZoneText, onCreateZone, onCreateLine, onCreateShape, onStroke, onEditing, onOverflow, onBackgroundSize,
}: {
  content: DocumentContent
  backgroundSrc: string
  selectedId: string | null
  /** Change quand le texte d'une zone a été remplacé d'ailleurs (annuler, recharger) : la zone est remontée. */
  contentKeys: Record<string, number>
  showFrames: boolean
  scale: number
  tool: StageTool
  brush: BrushSettings
  lineSettings: LineSettings
  shapeSettings: ShapeSettings
  /** Les coups de plume pas encore enregistrés, par calque de dessin. */
  paint: Record<string, Paint>
  /** L'adresse de l'image d'une pièce (image posée, calque de dessin enregistré), vide si elle n'en a pas. */
  pictureSrc: (asset: string) => string
  onScale: (scale: number) => void
  onSelect: (id: string | null) => void
  /** `history` : la première modification d'un geste (annuler y revient d'un coup). */
  onZoneChange: (id: string, next: (zone: DocumentZone) => DocumentZone, history: boolean) => void
  onPictureChange: (id: string, next: (picture: DocumentPicture) => DocumentPicture, history: boolean) => void
  onShapeChange: (id: string, next: (shape: DocumentShape) => DocumentShape, history: boolean) => void
  onLineChange: (id: string, next: (line: DocumentLine) => DocumentLine, history: boolean) => void
  onZoneText: (id: string, paragraphs: DocumentParagraph[]) => void
  onCreateZone: (rect: Rect) => void
  onCreateLine: (line: Pick<DocumentLine, "x1" | "y1" | "x2" | "y2">) => void
  onCreateShape: (rect: Rect) => void
  /** Un coup de plume ou de gomme fini : dans ce calque, ou (`null`) dans un nouveau calque de la page. */
  onStroke: (target: string | null, stroke: Stroke, pixels: Pixels, geometry: Box) => void
  onEditing: (id: string | null) => void
  onOverflow: (id: string, overflowing: boolean) => void
  onBackgroundSize: (width: number, height: number) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const pageLive = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [drawing, setDrawing] = useState<Rect | null>(null)
  const [newLine, setNewLine] = useState<Pick<DocumentLine, "x1" | "y1" | "x2" | "y2"> | null>(null)
  const [newShape, setNewShape] = useState<Rect | null>(null)
  const [pagePainting, setPagePainting] = useState(false)
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })
  const elements = orderedElements(content)
  const selectedZone = content.zones.find((zone) => zone.id === selectedId) ?? null
  const selectedPicture = (content.pictures ?? []).find((picture) => picture.id === selectedId) ?? null
  const selectedLine = (content.lines ?? []).find((line) => line.id === selectedId) ?? null
  const selectedShape = (content.shapes ?? []).find((shape) => shape.id === selectedId) ?? null
  const selectedBox: (Box & { id: string }) | null = selectedZone ?? selectedPicture ?? selectedShape
  const selecting = tool === "select"
  const painting = tool === "brush" || tool === "eraser"
  const pageWidth = Math.round(DOCUMENT_WIDTH * DRAWING_SCALE)
  const pageHeight = Math.round(content.height * DRAWING_SCALE)

  // La scène suit la largeur de la page.
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => onScale(Math.max(0.15, element.clientWidth / DOCUMENT_WIDTH))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [onScale])

  const toDocument = (client: Point): Point => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (client.x - rect.left) / scale, y: (client.y - rect.top) / scale }
  }

  function begin(next: Gesture, event: ReactPointerEvent) {
    gesture.current = next
    const move = (moveEvent: PointerEvent) => {
      // Les points intermédiaires du stylet ou de la souris : un trait de plume sans facettes.
      const events = next.kind === "paint" && typeof moveEvent.getCoalescedEvents === "function" ? moveEvent.getCoalescedEvents() : []
      if (events.length) for (const coalesced of events) step(coalesced)
      else step(moveEvent)
    }
    const end = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      finish(upEvent)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    event.preventDefault()
    event.stopPropagation()
  }

  /** Ajoute un point au coup de plume et le dessine aussitôt. */
  function addPaintPoint(current: Extract<Gesture, { kind: "paint" }>, event: PointerEvent | ReactPointerEvent) {
    const point = toDocument({ x: event.clientX, y: event.clientY })
    const local = documentToPicture(current.geometry, current.pixels, point)
    const pressure = current.pen ? 0.35 + 0.65 * Math.min(1, Math.max(0, event.pressure || 0.5)) : 1
    const points = current.stroke.points
    const count = points.length / 3
    if (count && Math.hypot(local.x - points[points.length - 3], local.y - points[points.length - 2]) < 0.6) return
    points.push(local.x, local.y, pressure)
    const context = current.canvas?.getContext("2d")
    if (context) paintStroke(context, current.stroke, Math.max(0, count))
  }

  function step(event: PointerEvent) {
    const current = gesture.current
    if (!current) return
    if (current.kind === "paint") { current.moved = true; addPaintPoint(current, event); return }
    const point = toDocument({ x: event.clientX, y: event.clientY })
    const dx = point.x - current.start.x
    const dy = point.y - current.start.y
    if (!current.moved && Math.hypot(dx, dy) * scale < 3) return
    const first = !current.moved
    current.moved = true
    if (current.kind === "draw") {
      setDrawing({ x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(dx), height: Math.abs(dy) })
      return
    }
    if (current.kind === "line-new") {
      const end = event.shiftKey ? snapAngle(current.start, point) : point
      setNewLine({ x1: current.start.x, y1: current.start.y, x2: end.x, y2: end.y })
      return
    }
    if (current.kind === "shape-new") {
      setNewShape(shapeRect(current.start, point, event.shiftKey))
      return
    }
    if (current.kind === "line-move") {
      const origin = current.origin
      onLineChange(current.id, (line) => ({ ...line, x1: origin.x1 + dx, y1: origin.y1 + dy, x2: origin.x2 + dx, y2: origin.y2 + dy }), first)
      return
    }
    if (current.kind === "line-end") {
      const origin = current.origin
      const fixed = current.end === 1 ? { x: origin.x2, y: origin.y2 } : { x: origin.x1, y: origin.y1 }
      const end = event.shiftKey ? snapAngle(fixed, point) : point
      onLineChange(current.id, (line) => current.end === 1 ? { ...line, x1: end.x, y1: end.y } : { ...line, x2: end.x, y2: end.y }, first)
      return
    }
    const origin = current.origin
    const change = (next: (box: Box) => Box) => {
      if (content.zones.some((zone) => zone.id === current.id)) onZoneChange(current.id, (zone) => ({ ...zone, ...next(zone) }), first)
      else if ((content.shapes ?? []).some((shape) => shape.id === current.id)) onShapeChange(current.id, (shape) => ({ ...shape, ...next(shape) }), first)
      else onPictureChange(current.id, (picture) => ({ ...picture, ...next(picture) }), first)
    }
    if (current.kind === "move") {
      let x = origin.x + dx
      let y = origin.y + dy
      // Le centre de l'élément s'aimante au milieu du document.
      const snap = 7 / scale
      const snapX = Math.abs(x + origin.width / 2 - DOCUMENT_WIDTH / 2) < snap
      const snapY = Math.abs(y + origin.height / 2 - content.height / 2) < snap
      if (snapX) x = DOCUMENT_WIDTH / 2 - origin.width / 2
      if (snapY) y = content.height / 2 - origin.height / 2
      setGuides({ x: snapX, y: snapY })
      change((box) => ({ ...box, x, y }))
      return
    }
    if (current.kind === "resize") {
      const [sx, sy] = current.handle
      const angle = (origin.rotation * Math.PI) / 180
      const cos = Math.cos(angle), sin = Math.sin(angle)
      // Le déplacement vu dans le repère incliné de l'élément : le côté opposé ne bouge pas.
      const localX = dx * cos + dy * sin
      const localY = -dx * sin + dy * cos
      const isPicture = !content.zones.some((zone) => zone.id === current.id)
      const minWidth = isPicture ? MIN_PICTURE : MIN_WIDTH
      const minHeight = isPicture ? MIN_PICTURE : MIN_HEIGHT
      let width = sx ? Math.max(minWidth, origin.width + sx * localX) : origin.width
      let height = sy ? Math.max(minHeight, origin.height + sy * localY) : origin.height
      // Une image garde ses proportions par ses coins (Maj : librement) ; une forme, avec Maj.
      const keep = current.keepRatio === "image" ? !event.shiftKey : current.keepRatio === "shift" && event.shiftKey
      if (keep && sx && sy) {
        const factor = Math.max(width / origin.width, height / origin.height)
        width = origin.width * factor
        height = origin.height * factor
      }
      const shiftX = (sx * (width - origin.width)) / 2
      const shiftY = (sy * (height - origin.height)) / 2
      const centerX = origin.x + origin.width / 2 + shiftX * cos - shiftY * sin
      const centerY = origin.y + origin.height / 2 + shiftX * sin + shiftY * cos
      change((box) => ({ ...box, x: centerX - width / 2, y: centerY - height / 2, width, height }))
      return
    }
    const centerX = origin.x + origin.width / 2
    const centerY = origin.y + origin.height / 2
    let rotation = (Math.atan2(point.y - centerY, point.x - centerX) * 180) / Math.PI + 90
    if (rotation > 180) rotation -= 360
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
    else {
      // Droit, couché ou à l'envers : aimanté à 3° près.
      const straight = Math.round(rotation / 90) * 90
      if (Math.abs(rotation - straight) < 3) rotation = straight
    }
    rotation = Math.round(rotation * 10) / 10
    change((box) => ({ ...box, rotation: rotation === -180 ? 180 : rotation }))
  }

  function finish(event: PointerEvent) {
    const current = gesture.current
    gesture.current = null
    setGuides({ x: false, y: false })
    if (!current) return
    if (current.kind === "paint") {
      setPagePainting(false)
      if (current.stroke.points.length >= 3) onStroke(current.target, current.stroke, current.pixels, current.geometry)
      else if (current.canvas && current.target === null) current.canvas.getContext("2d")?.clearRect(0, 0, current.canvas.width, current.canvas.height)
      return
    }
    if (current.kind === "draw") {
      setDrawing(null)
      const point = toDocument({ x: event.clientX, y: event.clientY })
      const rect = { x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(point.x - current.start.x), height: Math.abs(point.y - current.start.y) }
      if (current.moved && rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT) onCreateZone(rect)
      else onSelect(null)
      return
    }
    if (current.kind === "shape-new") {
      setNewShape(null)
      const rect = shapeRect(current.start, toDocument({ x: event.clientX, y: event.clientY }), event.shiftKey)
      if (current.moved && rect.width * scale >= 6 && rect.height * scale >= 6) onCreateShape(rect)
      return
    }
    if (current.kind === "line-new") {
      setNewLine(null)
      const point = toDocument({ x: event.clientX, y: event.clientY })
      const end = event.shiftKey ? snapAngle(current.start, point) : point
      if (current.moved && Math.hypot(end.x - current.start.x, end.y - current.start.y) * scale >= 6) onCreateLine({ x1: current.start.x, y1: current.start.y, x2: end.x, y2: end.y })
      return
    }
    // Un clic sans glisser sur une zone : on écrit dedans, là où l'on a cliqué.
    if (current.kind === "move" && !current.moved && current.focusOnClick) {
      const click = current.focusOnClick
      const id = current.id
      requestAnimationFrame(() => {
        const element = stage.current?.querySelector<HTMLElement>(`[data-document-zone="${CSS.escape(id)}"] [contenteditable="true"]`)
        if (element) focusAt(element, click)
      })
    }
  }

  function zonePointerDown(zone: DocumentZone, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !selecting) return
    if (zone.id === selectedId) {
      // Déjà choisie : le clic place le curseur ; à côté du texte, il va à la fin.
      const target = event.target as HTMLElement
      if (!target.isContentEditable) {
        event.preventDefault()
        const element = event.currentTarget.querySelector<HTMLElement>("[contenteditable=\"true\"]")
        if (element) focusAt(element, null)
      }
      return
    }
    onSelect(zone.id)
    begin({ kind: "move", id: zone.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: zone, moved: false, focusOnClick: { x: event.clientX, y: event.clientY } }, event)
  }

  function picturePointerDown(picture: DocumentPicture, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !selecting) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    onSelect(picture.id)
    begin({ kind: "move", id: picture.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: picture, moved: false, focusOnClick: null }, event)
  }

  function shapePointerDown(shape: DocumentShape, event: ReactPointerEvent<SVGPathElement>) {
    if (event.button !== 0 || !selecting) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    onSelect(shape.id)
    begin({ kind: "move", id: shape.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: shape, moved: false, focusOnClick: null }, event)
  }

  function linePointerDown(line: DocumentLine, event: ReactPointerEvent<SVGLineElement>) {
    if (event.button !== 0 || !selecting) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    onSelect(line.id)
    begin({ kind: "line-move", id: line.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: line, moved: false }, event)
  }

  /** Le calque de dessin dont l'encre est sous le pointeur (le plus haut d'abord). */
  function drawingAt(point: Point) {
    const drawings = elements.flatMap((element) => element.kind === "picture" && element.picture.kind === "drawing" ? [element.picture] : []).reverse()
    for (const picture of drawings) {
      const canvas = drawingCanvas(stage.current, picture.id, "committed")
      if (!canvas) continue
      const local = documentToPicture(picture, canvas, point)
      if (local.x < 0 || local.y < 0 || local.x >= canvas.width || local.y >= canvas.height) continue
      // Autour du point, pour qu'un trait fin se saisisse sans viser au pixel près.
      const radius = Math.max(2, Math.round((6 / scale) * (canvas.width / picture.width)))
      const x = Math.max(0, Math.round(local.x) - radius), y = Math.max(0, Math.round(local.y) - radius)
      const data = canvas.getContext("2d")?.getImageData(x, y, Math.min(canvas.width - x, radius * 2), Math.min(canvas.height - y, radius * 2)).data
      if (data) for (let index = 3; index < data.length; index += 4) if (data[index] > 24) return picture
    }
    return null
  }

  function stagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-document-zone], [data-document-handle], [data-document-picture]")) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const start = toDocument({ x: event.clientX, y: event.clientY })
    if (tool === "line") { begin({ kind: "line-new", start, moved: false }, event); return }
    if (tool === "shape") { begin({ kind: "shape-new", start, moved: false }, event); return }
    if (painting) { beginPaint(start, event); return }
    const drawn = drawingAt(start)
    if (drawn) {
      onSelect(drawn.id)
      begin({ kind: "move", id: drawn.id, start, origin: drawn, moved: false, focusOnClick: null }, event)
      return
    }
    begin({ kind: "draw", start, moved: false }, event)
  }

  function beginPaint(start: Point, event: ReactPointerEvent<HTMLDivElement>) {
    const drawings = (content.pictures ?? []).filter((picture) => picture.kind === "drawing")
    const chosen = drawings.find((picture) => picture.id === selectedId)
      ?? (tool === "eraser" ? [...elements].reverse().flatMap((element) => element.kind === "picture" && element.picture.kind === "drawing" ? [element.picture] : [])[0] : undefined)
    if (!chosen && tool === "eraser") return
    const canvas = chosen ? drawingCanvas(stage.current, chosen.id, tool === "eraser" ? "committed" : "live") : pageLive.current
    const pixels = chosen ? (canvas ? { width: canvas.width, height: canvas.height } : { width: chosen.width * DRAWING_SCALE, height: chosen.height * DRAWING_SCALE }) : { width: pageWidth, height: pageHeight }
    const geometry: Box = chosen ?? { x: 0, y: 0, width: DOCUMENT_WIDTH, height: content.height, rotation: 0 }
    const ratio = pixels.width / geometry.width
    const stroke: Stroke = tool === "eraser"
      ? { points: [], size: brush.eraserSize * ratio, color: "#000000", opacity: 1, nib: 0, angle: 0, erase: true }
      : { points: [], size: brush.size * ratio, color: brush.color, opacity: brush.opacity, nib: brush.nib, angle: brush.angle, erase: false }
    if (canvas && !stroke.erase) canvas.style.opacity = String(stroke.opacity)
    if (!chosen && canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
      setPagePainting(true)
    }
    const next: Extract<Gesture, { kind: "paint" }> = { kind: "paint", start, moved: false, target: chosen?.id ?? null, geometry, pixels, stroke, canvas, pen: event.pointerType === "pen" }
    addPaintPoint(next, event)
    begin(next, event)
  }

  // Le cercle de la plume ou de la gomme suit le pointeur.
  function hover(event: ReactPointerEvent<HTMLDivElement>) {
    const element = cursor.current
    if (!element) return
    const point = toDocument({ x: event.clientX, y: event.clientY })
    const size = tool === "eraser" ? brush.eraserSize : brush.size
    element.style.transform = `translate(${point.x - size / 2}px, ${point.y - size / 2}px)`
    element.style.width = element.style.height = `${size}px`
    element.style.display = "block"
  }

  const ui = 1 / scale
  const editingLine = newLine ? { ...lineSettings, ...newLine } : null
  return <div ref={frame} className="relative w-full select-none" style={{ height: content.height * scale }}>
    <div
      ref={stage}
      onPointerDown={stagePointerDown}
      onPointerMove={painting ? hover : undefined}
      onPointerLeave={() => { if (cursor.current) cursor.current.style.display = "none" }}
      className={cn("absolute left-0 top-0 origin-top-left touch-none", painting ? "cursor-none" : "cursor-crosshair")}
      style={{ width: DOCUMENT_WIDTH, height: content.height, transform: `scale(${scale})` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {backgroundSrc && <img src={backgroundSrc} alt="" draggable={false} onLoad={(event) => onBackgroundSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} className="pointer-events-none absolute inset-0 size-full select-none" />}
      {elements.map((element) => {
        if (element.kind === "zone") {
          const zone = element.zone
          return <ZoneText
            key={`${zone.id}:${contentKeys[zone.id] ?? 0}`}
            zone={zone}
            selected={zone.id === selectedId}
            interactive={selecting}
            onPointerDown={(event) => zonePointerDown(zone, event)}
            onText={(paragraphs) => onZoneText(zone.id, paragraphs)}
            onFocus={() => onEditing(zone.id)}
            onBlur={() => onEditing(null)}
            onOverflow={(overflowing) => onOverflow(zone.id, overflowing)}
          />
        }
        if (element.kind === "shape") return <ShapeView key={element.id} shape={element.shape} interactive={selecting} scale={scale} onPointerDown={(event) => shapePointerDown(element.shape, event)} />
        if (element.kind === "line") return <LineView key={element.id} line={element.line} height={content.height} interactive={selecting} scale={scale} onPointerDown={(event) => linePointerDown(element.line, event)} />
        const picture = element.picture
        return picture.kind === "drawing"
          ? <DrawingLayer key={element.id} picture={picture} src={pictureSrc(picture.asset)} paint={paint[picture.id]} />
          : <PictureImage key={element.id} picture={picture} src={pictureSrc(picture.asset)} interactive={selecting} onPointerDown={(event) => picturePointerDown(picture, event)} />
      })}
      {/* Le premier coup de plume d'un nouveau calque, en attendant le calque. */}
      <canvas ref={pageLive} width={pageWidth} height={pageHeight} className={cn("pointer-events-none absolute inset-0 size-full", !pagePainting && "hidden")} />
      {newShape && <ShapeView shape={{ id: "nouvelle", ...shapeSettings, ...newShape, rotation: 0 }} interactive={false} scale={scale} onPointerDown={() => undefined} />}
      {editingLine && <LineView line={{ id: "nouvelle", ...editingLine }} height={content.height} interactive={false} scale={scale} onPointerDown={() => undefined} />}

      {/* Les cadres et poignées : au-dessus de tout, sans se mêler au papier. */}
      {selecting && showFrames && content.zones.filter((zone) => zone.id !== selectedId).map((zone) => <div key={zone.id} className="pointer-events-none absolute border border-dashed border-primary/45" style={{ ...boxStyle(zone), borderWidth: ui }} />)}
      {selecting && selectedBox && <div className="pointer-events-none absolute" style={boxStyle(selectedBox)}>
        <div className="absolute inset-0 border-dashed border-primary" style={{ borderWidth: 1.5 * ui, margin: -3 * ui }} />
        {/* Les bords : on y saisit l'élément pour le déplacer. */}
        {[{ top: -9 * ui, left: 0, right: 0, height: 10 * ui }, { bottom: -9 * ui, left: 0, right: 0, height: 10 * ui }, { left: -9 * ui, top: 0, bottom: 0, width: 10 * ui }, { right: -9 * ui, top: 0, bottom: 0, width: 10 * ui }].map((style, index) => <div
          key={index}
          data-document-handle
          className="pointer-events-auto absolute cursor-move"
          style={style}
          onPointerDown={(event) => begin({ kind: "move", id: selectedBox.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selectedBox, moved: false, focusOnClick: null }, event)}
        />)}
        {handles.map(([sx, sy]) => <div
          key={`${sx}:${sy}`}
          data-document-handle
          title={selectedPicture?.kind === "image" && sx && sy ? "Redimensionner (Maj : sans garder les proportions)" : selectedShape && sx && sy ? "Redimensionner (Maj : en gardant les proportions)" : "Redimensionner"}
          className="pointer-events-auto absolute rounded-[2px] border border-primary bg-background shadow-sm"
          style={{ width: 11 * ui, height: 11 * ui, left: `calc(${(sx + 1) * 50}% - ${5.5 * ui}px)`, top: `calc(${(sy + 1) * 50}% - ${5.5 * ui}px)`, borderWidth: 1.5 * ui, cursor: handleCursor(sx, sy) }}
          onPointerDown={(event) => begin({ kind: "resize", id: selectedBox.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selectedBox, moved: false, handle: [sx, sy], keepRatio: selectedPicture?.kind === "image" ? "image" : selectedShape ? "shift" : "none" }, event)}
        />)}
        <div className="absolute left-1/2 bg-primary" style={{ width: 1.5 * ui, height: 18 * ui, top: -26 * ui, marginLeft: -0.75 * ui }} />
        <button
          type="button"
          data-document-handle
          title="Incliner (Maj : par pas de 15°)"
          aria-label="Incliner"
          className="pointer-events-auto absolute left-1/2 flex cursor-grab items-center justify-center rounded-full border border-primary bg-background text-primary shadow-sm active:cursor-grabbing"
          style={{ width: 22 * ui, height: 22 * ui, top: -46 * ui, marginLeft: -11 * ui, borderWidth: 1.5 * ui }}
          onPointerDown={(event) => begin({ kind: "rotate", id: selectedBox.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selectedBox, moved: false }, event)}
        ><RotateCw style={{ width: 12 * ui, height: 12 * ui }} /></button>
        <button
          type="button"
          data-document-handle
          title="Déplacer"
          aria-label="Déplacer"
          className="pointer-events-auto absolute flex cursor-move items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground shadow-sm"
          style={{ width: 22 * ui, height: 22 * ui, top: -30 * ui, left: -30 * ui, borderWidth: 1.5 * ui }}
          onPointerDown={(event) => begin({ kind: "move", id: selectedBox.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selectedBox, moved: false, focusOnClick: null }, event)}
        ><Move style={{ width: 12 * ui, height: 12 * ui }} /></button>
      </div>}
      {selecting && selectedLine && <>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={DOCUMENT_WIDTH} height={content.height}>
          <line x1={selectedLine.x1} y1={selectedLine.y1} x2={selectedLine.x2} y2={selectedLine.y2} className="stroke-primary" strokeWidth={1.5 * ui} strokeDasharray={`${5 * ui} ${4 * ui}`} />
        </svg>
        {([1, 2] as const).map((end) => <div
          key={end}
          data-document-handle
          title="Déplacer ce bout (Maj : par pas de 15°)"
          className="pointer-events-auto absolute cursor-crosshair rounded-full border border-primary bg-background shadow-sm"
          style={{ width: 13 * ui, height: 13 * ui, left: (end === 1 ? selectedLine.x1 : selectedLine.x2) - 6.5 * ui, top: (end === 1 ? selectedLine.y1 : selectedLine.y2) - 6.5 * ui, borderWidth: 1.5 * ui }}
          onPointerDown={(event) => begin({ kind: "line-end", id: selectedLine.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selectedLine, end, moved: false }, event)}
        />)}
      </>}

      {guides.x && <div className="pointer-events-none absolute top-0 bg-primary/70" style={{ left: DOCUMENT_WIDTH / 2, width: ui, height: content.height }} />}
      {guides.y && <div className="pointer-events-none absolute left-0 bg-primary/70" style={{ top: content.height / 2, height: ui, width: DOCUMENT_WIDTH }} />}
      {drawing && <div className="pointer-events-none absolute rounded-sm border border-dashed border-primary bg-primary/10" style={{ left: drawing.x, top: drawing.y, width: drawing.width, height: drawing.height, borderWidth: 1.5 * ui }} />}
      {painting && <div ref={cursor} className="pointer-events-none absolute left-0 top-0 hidden rounded-full border border-black/60 shadow-[0_0_0_1px_rgb(255_255_255/0.7)]" style={{ borderWidth: ui }} />}
    </div>
  </div>
}

/** La boîte d'une nouvelle forme, d'un coin à l'autre (Maj : carrée). */
function shapeRect(start: Point, end: Point, square: boolean): Rect {
  let width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y)
  if (square) width = height = Math.max(width, height)
  return { x: end.x < start.x ? start.x - width : start.x, y: end.y < start.y ? start.y - height : start.y, width, height }
}

/** Le bout d'une ligne, aimanté par pas de 15° autour de l'autre bout. */
function snapAngle(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 12)) * (Math.PI / 12)
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length }
}
