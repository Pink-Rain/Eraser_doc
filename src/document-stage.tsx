import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { Move, RotateCw } from "lucide-react"

import { DOCUMENT_WIDTH, type DocumentContent, type DocumentParagraph, type DocumentZone } from "@/lib/document-model"
import { cn } from "@/lib/utils"

import { documentFonts } from "./document-assets"
import { paragraphsAreEmpty, paragraphsFromElement, paragraphsToHtml } from "./document-text"

/**
 * La scène de l'éditeur de documents : le fond à la taille de l'écran, les zones de texte
 * posées dessus. Une zone se choisit d'un clic (on écrit aussitôt dedans), se déplace par
 * son cadre ou sa poignée, se redimensionne par ses coins et ses côtés, s'incline par la
 * poignée ronde (Maj : par pas de 15°). Tracer un rectangle sur le fond crée une zone.
 *
 * Tout est mesuré en unités du document (largeur 1000) : la scène est simplement agrandie
 * ou réduite d'un facteur, comme le rendu (components/eraser/document-render.ts).
 */

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Gesture =
  | { kind: "move"; id: string; start: Point; origin: DocumentZone; moved: boolean; focusOnClick: Point | null }
  | { kind: "resize"; id: string; start: Point; origin: DocumentZone; moved: boolean; handle: readonly [number, number] }
  | { kind: "rotate"; id: string; start: Point; origin: DocumentZone; moved: boolean }
  | { kind: "draw"; start: Point; moved: boolean }

const MIN_WIDTH = 30
const MIN_HEIGHT = 16
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

function ZoneText({ zone, selected, onPointerDown, onText, onFocus, onBlur, onOverflow }: {
  zone: DocumentZone
  selected: boolean
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
    className={cn("absolute flex flex-col", zone.valign === "middle" ? "justify-center" : zone.valign === "bottom" ? "justify-end" : "justify-start", selected ? "cursor-text" : "cursor-pointer")}
    style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height, transform: `rotate(${zone.rotation}deg)`, opacity: zone.opacity, mixBlendMode: zone.ink ? "multiply" : "normal" }}
  >
    <div
      ref={editable}
      contentEditable={selected}
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

export function DocumentStage({ content, backgroundSrc, selectedId, contentKeys, showFrames, scale, onScale, onSelect, onZoneChange, onZoneText, onCreateZone, onEditing, onOverflow, onBackgroundSize }: {
  content: DocumentContent
  backgroundSrc: string
  selectedId: string | null
  /** Change quand le texte d'une zone a été remplacé d'ailleurs (annuler, recharger) : la zone est remontée. */
  contentKeys: Record<string, number>
  showFrames: boolean
  scale: number
  onScale: (scale: number) => void
  onSelect: (id: string | null) => void
  /** `history` : la première modification d'un geste (annuler y revient d'un coup). */
  onZoneChange: (id: string, next: (zone: DocumentZone) => DocumentZone, history: boolean) => void
  onZoneText: (id: string, paragraphs: DocumentParagraph[]) => void
  onCreateZone: (rect: Rect) => void
  onEditing: (id: string | null) => void
  onOverflow: (id: string, overflowing: boolean) => void
  onBackgroundSize: (width: number, height: number) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [drawing, setDrawing] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })
  const selected = content.zones.find((zone) => zone.id === selectedId) ?? null

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
    const move = (moveEvent: PointerEvent) => step(moveEvent)
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

  function step(event: PointerEvent) {
    const current = gesture.current
    if (!current) return
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
    const origin = current.origin
    if (current.kind === "move") {
      let x = origin.x + dx
      let y = origin.y + dy
      // Le centre de la zone s'aimante au milieu du document.
      const snap = 7 / scale
      const snapX = Math.abs(x + origin.width / 2 - DOCUMENT_WIDTH / 2) < snap
      const snapY = Math.abs(y + origin.height / 2 - content.height / 2) < snap
      if (snapX) x = DOCUMENT_WIDTH / 2 - origin.width / 2
      if (snapY) y = content.height / 2 - origin.height / 2
      setGuides({ x: snapX, y: snapY })
      onZoneChange(current.id, (zone) => ({ ...zone, x, y }), first)
      return
    }
    if (current.kind === "resize") {
      const [sx, sy] = current.handle
      const angle = (origin.rotation * Math.PI) / 180
      const cos = Math.cos(angle), sin = Math.sin(angle)
      // Le déplacement vu dans le repère incliné de la zone : le côté opposé ne bouge pas.
      const localX = dx * cos + dy * sin
      const localY = -dx * sin + dy * cos
      const width = sx ? Math.max(MIN_WIDTH, origin.width + sx * localX) : origin.width
      const height = sy ? Math.max(MIN_HEIGHT, origin.height + sy * localY) : origin.height
      const shiftX = (sx * (width - origin.width)) / 2
      const shiftY = (sy * (height - origin.height)) / 2
      const centerX = origin.x + origin.width / 2 + shiftX * cos - shiftY * sin
      const centerY = origin.y + origin.height / 2 + shiftX * sin + shiftY * cos
      onZoneChange(current.id, (zone) => ({ ...zone, x: centerX - width / 2, y: centerY - height / 2, width, height }), first)
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
    onZoneChange(current.id, (zone) => ({ ...zone, rotation: rotation === -180 ? 180 : rotation }), first)
  }

  function finish(event: PointerEvent) {
    const current = gesture.current
    gesture.current = null
    setGuides({ x: false, y: false })
    if (!current) return
    if (current.kind === "draw") {
      setDrawing(null)
      const point = toDocument({ x: event.clientX, y: event.clientY })
      const rect = { x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(point.x - current.start.x), height: Math.abs(point.y - current.start.y) }
      if (current.moved && rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT) onCreateZone(rect)
      else onSelect(null)
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
    if (event.button !== 0) return
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

  function stagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-document-zone], [data-document-handle]")) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    begin({ kind: "draw", start: toDocument({ x: event.clientX, y: event.clientY }), moved: false }, event)
  }

  const ui = 1 / scale
  return <div ref={frame} className="relative w-full select-none" style={{ height: content.height * scale }}>
    <div
      ref={stage}
      onPointerDown={stagePointerDown}
      className="absolute left-0 top-0 origin-top-left cursor-crosshair"
      style={{ width: DOCUMENT_WIDTH, height: content.height, transform: `scale(${scale})` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {backgroundSrc && <img src={backgroundSrc} alt="" draggable={false} onLoad={(event) => onBackgroundSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} className="pointer-events-none absolute inset-0 size-full select-none" />}
      {content.zones.map((zone) => <ZoneText
        key={`${zone.id}:${contentKeys[zone.id] ?? 0}`}
        zone={zone}
        selected={zone.id === selectedId}
        onPointerDown={(event) => zonePointerDown(zone, event)}
        onText={(paragraphs) => onZoneText(zone.id, paragraphs)}
        onFocus={() => onEditing(zone.id)}
        onBlur={() => onEditing(null)}
        onOverflow={(overflowing) => onOverflow(zone.id, overflowing)}
      />)}

      {/* Les cadres et poignées : au-dessus du texte, sans se mêler au papier. */}
      {content.zones.filter((zone) => zone.id !== selectedId && showFrames).map((zone) => <div key={zone.id} className="pointer-events-none absolute border border-dashed border-primary/45" style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height, transform: `rotate(${zone.rotation}deg)`, borderWidth: ui }} />)}
      {selected && <div className="pointer-events-none absolute" style={{ left: selected.x, top: selected.y, width: selected.width, height: selected.height, transform: `rotate(${selected.rotation}deg)` }}>
        <div className="absolute inset-0 border-dashed border-primary" style={{ borderWidth: 1.5 * ui, margin: -3 * ui }} />
        {/* Les bords : on y saisit la zone pour la déplacer. */}
        {[{ top: -9 * ui, left: 0, right: 0, height: 10 * ui }, { bottom: -9 * ui, left: 0, right: 0, height: 10 * ui }, { left: -9 * ui, top: 0, bottom: 0, width: 10 * ui }, { right: -9 * ui, top: 0, bottom: 0, width: 10 * ui }].map((style, index) => <div
          key={index}
          data-document-handle
          className="pointer-events-auto absolute cursor-move"
          style={style}
          onPointerDown={(event) => begin({ kind: "move", id: selected.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selected, moved: false, focusOnClick: null }, event)}
        />)}
        {handles.map(([sx, sy]) => <div
          key={`${sx}:${sy}`}
          data-document-handle
          title="Redimensionner"
          className="pointer-events-auto absolute rounded-[2px] border border-primary bg-background shadow-sm"
          style={{ width: 11 * ui, height: 11 * ui, left: `calc(${(sx + 1) * 50}% - ${5.5 * ui}px)`, top: `calc(${(sy + 1) * 50}% - ${5.5 * ui}px)`, borderWidth: 1.5 * ui, cursor: handleCursor(sx, sy) }}
          onPointerDown={(event) => begin({ kind: "resize", id: selected.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selected, moved: false, handle: [sx, sy] }, event)}
        />)}
        <div className="absolute left-1/2 bg-primary" style={{ width: 1.5 * ui, height: 18 * ui, top: -26 * ui, marginLeft: -0.75 * ui }} />
        <button
          type="button"
          data-document-handle
          title="Incliner (Maj : par pas de 15°)"
          aria-label="Incliner la zone"
          className="pointer-events-auto absolute left-1/2 flex cursor-grab items-center justify-center rounded-full border border-primary bg-background text-primary shadow-sm active:cursor-grabbing"
          style={{ width: 22 * ui, height: 22 * ui, top: -46 * ui, marginLeft: -11 * ui, borderWidth: 1.5 * ui }}
          onPointerDown={(event) => begin({ kind: "rotate", id: selected.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selected, moved: false }, event)}
        ><RotateCw style={{ width: 12 * ui, height: 12 * ui }} /></button>
        <button
          type="button"
          data-document-handle
          title="Déplacer la zone"
          aria-label="Déplacer la zone"
          className="pointer-events-auto absolute flex cursor-move items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground shadow-sm"
          style={{ width: 22 * ui, height: 22 * ui, top: -30 * ui, left: -30 * ui, borderWidth: 1.5 * ui }}
          onPointerDown={(event) => begin({ kind: "move", id: selected.id, start: toDocument({ x: event.clientX, y: event.clientY }), origin: selected, moved: false, focusOnClick: null }, event)}
        ><Move style={{ width: 12 * ui, height: 12 * ui }} /></button>
      </div>}

      {guides.x && <div className="pointer-events-none absolute top-0 bg-primary/70" style={{ left: DOCUMENT_WIDTH / 2, width: ui, height: content.height }} />}
      {guides.y && <div className="pointer-events-none absolute left-0 bg-primary/70" style={{ top: content.height / 2, height: ui, width: DOCUMENT_WIDTH }} />}
      {drawing && <div className="pointer-events-none absolute rounded-sm border border-dashed border-primary bg-primary/10" style={{ left: drawing.x, top: drawing.y, width: drawing.width, height: drawing.height, borderWidth: 1.5 * ui }} />}
    </div>
  </div>
}
