import {
  DEFAULT_INK, DOCUMENT_RENDER_WIDTH, DOCUMENT_WIDTH,
  type DocumentBlendMode, type DocumentContent, type DocumentLine, type DocumentLineStyle, type DocumentMetal, type DocumentPicture, type DocumentRelief, type DocumentShape, type DocumentShapeKind, type DocumentZone,
} from "@/lib/document-model"

/**
 * Les éléments d'un document en plus du texte : lignes droites, formes, images posées et calques
 * de dessin, l'ordre des calques et les modes de fusion. Ce fichier sert à la fois à l'éditeur (la
 * scène, en CSS) et au rendu (le canvas) : un mode, un pointillé, un coup de plume se dessinent
 * de la même façon des deux côtés.
 *
 * Seuls les types viennent d'Eraser : un Eraser plus ancien que l'alpha 285 ne prête pas encore
 * ces valeurs (l'éditeur n'en propose alors pas les outils, `features`).
 */

/* ---------- modes de fusion ---------- */

export const blendModes: ReadonlyArray<{ value: DocumentBlendMode; label: string; css: string; canvas: GlobalCompositeOperation }> = [
  { value: "normal", label: "Normal", css: "normal", canvas: "source-over" },
  { value: "multiply", label: "Multiplier", css: "multiply", canvas: "multiply" },
  { value: "darken", label: "Assombrir", css: "darken", canvas: "darken" },
  { value: "screen", label: "Superposition", css: "screen", canvas: "screen" },
  { value: "lighten", label: "Éclaircir", css: "lighten", canvas: "lighten" },
  { value: "addition", label: "Addition", css: "plus-lighter", canvas: "lighter" },
  { value: "overlay", label: "Incrustation", css: "overlay", canvas: "overlay" },
  { value: "soft-light", label: "Lumière douce", css: "soft-light", canvas: "soft-light" },
  { value: "color", label: "Couleur", css: "color", canvas: "color" },
  { value: "saturation", label: "Saturation", css: "saturation", canvas: "saturation" },
  { value: "luminosity", label: "Luminosité", css: "luminosity", canvas: "luminosity" },
]
const blendOf = (mode: DocumentBlendMode | undefined) => blendModes.find((candidate) => candidate.value === mode) ?? blendModes[0]
export const blendCss = (mode: DocumentBlendMode | undefined) => blendOf(mode).css as "normal"
export const blendCanvas = (mode: DocumentBlendMode | undefined) => blendOf(mode).canvas

/** Le mode d'une zone de texte : le sien, sinon celui de l'ancienne case « encre mêlée au papier ». */
export const zoneBlend = (zone: Pick<DocumentZone, "blend" | "ink">): DocumentBlendMode => zone.blend ?? (zone.ink ? "multiply" : "normal")

/* ---------- le contenu et l'ordre des calques ---------- */

/** Un contenu complet, même venu d'un Eraser qui ne connaît que les zones de texte. */
export function normalizeContent(content: DocumentContent): DocumentContent {
  const lines = Array.isArray(content.lines) ? content.lines : []
  const shapes = Array.isArray(content.shapes) ? content.shapes : []
  const pictures = Array.isArray(content.pictures) ? content.pictures : []
  const ids = new Set([...content.zones, ...lines, ...shapes, ...pictures].map((element) => element.id))
  const listed = Array.isArray(content.order) ? content.order.filter((id) => ids.has(id)) : []
  const order = [...new Set([...listed, ...content.zones.map((zone) => zone.id), ...lines.map((line) => line.id), ...shapes.map((shape) => shape.id), ...pictures.map((picture) => picture.id)])]
  return { ...content, lines, shapes, pictures, order }
}

export type DocumentElement =
  | { kind: "zone"; id: string; zone: DocumentZone }
  | { kind: "line"; id: string; line: DocumentLine }
  | { kind: "shape"; id: string; shape: DocumentShape }
  | { kind: "picture"; id: string; picture: DocumentPicture }

/** Les éléments du plus bas au plus haut. */
export function orderedElements(content: DocumentContent): DocumentElement[] {
  const byId = new Map<string, DocumentElement>()
  for (const zone of content.zones) byId.set(zone.id, { kind: "zone", id: zone.id, zone })
  for (const line of content.lines ?? []) byId.set(line.id, { kind: "line", id: line.id, line })
  for (const shape of content.shapes ?? []) byId.set(shape.id, { kind: "shape", id: shape.id, shape })
  for (const picture of content.pictures ?? []) byId.set(picture.id, { kind: "picture", id: picture.id, picture })
  const ordered = (content.order ?? []).flatMap((id) => {
    const element = byId.get(id)
    byId.delete(id)
    return element ? [element] : []
  })
  return [...ordered, ...byId.values()]
}

/** Un élément de plus, posé au-dessus des autres. */
export function withElementOnTop(content: DocumentContent, element: DocumentElement): DocumentContent {
  const normalized = normalizeContent(content)
  return {
    ...normalized,
    zones: element.kind === "zone" ? [...normalized.zones, element.zone] : normalized.zones,
    lines: element.kind === "line" ? [...normalized.lines, element.line] : normalized.lines,
    shapes: element.kind === "shape" ? [...normalized.shapes, element.shape] : normalized.shapes,
    pictures: element.kind === "picture" ? [...normalized.pictures, element.picture] : normalized.pictures,
    order: [...normalized.order.filter((id) => id !== element.id), element.id],
  }
}

export function withoutElement(content: DocumentContent, id: string): DocumentContent {
  const normalized = normalizeContent(content)
  return {
    ...normalized,
    zones: normalized.zones.filter((zone) => zone.id !== id),
    lines: normalized.lines.filter((line) => line.id !== id),
    shapes: normalized.shapes.filter((shape) => shape.id !== id),
    pictures: normalized.pictures.filter((picture) => picture.id !== id),
    order: normalized.order.filter((candidate) => candidate !== id),
  }
}

/** Monte (`1`), descend (`-1`) d'un cran, ou passe tout en haut (`"top"`) ou tout en bas (`"bottom"`). */
export function movedInOrder(content: DocumentContent, id: string, move: 1 | -1 | "top" | "bottom"): DocumentContent {
  const order = normalizeContent(content).order.filter((candidate) => candidate !== id)
  const index = normalizeContent(content).order.indexOf(id)
  if (index < 0) return content
  const at = move === "top" ? order.length : move === "bottom" ? 0 : Math.min(order.length, Math.max(0, index + move))
  order.splice(at, 0, id)
  return { ...normalizeContent(content), order }
}

/* ---------- pages ---------- */

/**
 * Le contenu d'une page recopié pour une autre (dupliquer une page) : chaque élément a un nouvel
 * identifiant (l'ordre des calques suit), chaque calque de dessin un nouveau fichier (il sera
 * dessiné à part), une image posée garde le sien ; elle n'est jamais couverture ni image de fin.
 * `ids` et `assets` : les anciens noms et les nouveaux.
 */
export function copiedContent(content: DocumentContent) {
  // La copie d'une couverture (ou d'une image de fin) est une page ordinaire.
  const { role: _role, ...normalized } = normalizeContent(content)
  const ids = new Map<string, string>()
  const assets = new Map<string, string>()
  const fresh = (id: string) => {
    const next = crypto.randomUUID()
    ids.set(id, next)
    return next
  }
  const zones = normalized.zones.map((zone) => ({ ...zone, id: fresh(zone.id), paragraphs: zone.paragraphs.map((paragraph) => paragraph.map((run) => ({ ...run }))) }))
  const lines = normalized.lines.map((line) => ({ ...line, id: fresh(line.id) }))
  const shapes = normalized.shapes.map((shape) => ({ ...shape, id: fresh(shape.id) }))
  const pictures = normalized.pictures.map((picture) => {
    const asset = picture.kind === "drawing" ? crypto.randomUUID() : picture.asset
    if (asset !== picture.asset) assets.set(picture.asset, asset)
    return { ...picture, id: fresh(picture.id), asset }
  })
  return { content: { ...normalized, zones, lines, shapes, pictures, order: normalized.order.map((id) => ids.get(id) ?? id) }, ids, assets }
}

/**
 * La suite d'une page, sur le même fond : ses zones de texte à la même place et dans le même style
 * (police, taille, encre, alignement), vides ; ni lignes, ni formes, ni images.
 */
export function continuedContent(content: DocumentContent): DocumentContent {
  const zones = orderedElements(content).flatMap((element) => element.kind === "zone" ? [{ ...element.zone, id: crypto.randomUUID(), paragraphs: [] }] : [])
  return { version: 1, height: content.height, zones, lines: [], shapes: [], pictures: [], order: zones.map((zone) => zone.id) }
}

export const elementLabel = (element: DocumentElement) => {
  if (element.kind === "line") return "Ligne"
  if (element.kind === "shape") return shapeKinds.find((kind) => kind.value === element.shape.shape)?.label ?? "Forme"
  if (element.kind === "picture") return element.picture.kind === "drawing" ? "Dessin" : "Image"
  const text = element.zone.paragraphs.map((paragraph) => paragraph.map((run) => run.text).join("")).join(" ").trim()
  return text ? `« ${text.length > 28 ? `${text.slice(0, 28)}…` : text} »` : "Texte vide"
}

/* ---------- relief et métal du texte ---------- */

/** Les reliefs proposés (clés d'Eraser, `documentReliefs`) : à plat, sortant, gravé. */
export const reliefKinds: ReadonlyArray<{ value: DocumentRelief | "none"; label: string; title: string }> = [
  { value: "none", label: "À plat", title: "Sans relief" },
  { value: "raised", label: "Sortant", title: "Le texte sort du papier : éclairé d'un côté, ombré de l'autre, avec son ombre portée" },
  { value: "engraved", label: "Gravé", title: "Le texte est gravé dans le papier : ombré du côté de la lumière, éclairé de l'autre" },
]

/**
 * Les métaux (clés d'Eraser, `documentMetals`) : un dégradé de haut en bas de chaque ligne, avec
 * un reflet clair un peu au-dessus du milieu. Le même en CSS (scène) et dans le canvas (rendu).
 */
export const metals: ReadonlyArray<{ value: DocumentMetal; label: string; stops: ReadonlyArray<readonly [number, string]> }> = [
  { value: "gold", label: "Or", stops: [[0, "#7a5410"], [0.3, "#e3bd52"], [0.46, "#fff3c2"], [0.56, "#c8952a"], [1, "#6b470c"]] },
  { value: "silver", label: "Argent", stops: [[0, "#575c62"], [0.3, "#c9ced3"], [0.46, "#ffffff"], [0.56, "#979da3"], [1, "#4b5056"]] },
  { value: "bronze", label: "Bronze", stops: [[0, "#4a2c10"], [0.3, "#b58048"], [0.46, "#f0cf9e"], [0.56, "#8c5a2b"], [1, "#3d230b"]] },
  { value: "copper", label: "Cuivre", stops: [[0, "#58210b"], [0.3, "#cd6d47"], [0.46, "#ffcaa9"], [0.56, "#a64e27"], [1, "#4a1c08"]] },
]
const metalOf = (metal: DocumentMetal | undefined) => metals.find((candidate) => candidate.value === metal) ?? null
export const metalStops = (metal: DocumentMetal | undefined) => metalOf(metal)?.stops ?? []

/** Le dégradé d'un métal en CSS (une ligne de haut en bas). */
export function metalGradientCss(metal: DocumentMetal | undefined) {
  const stops = metalStops(metal)
  return stops.length ? `linear-gradient(180deg, ${stops.map(([offset, color]) => `${color} ${Math.round(offset * 100)}%`).join(", ")})` : ""
}

/** Une ombre (ou une lumière) du relief, en unités du document, dans le repère de la zone (avant son inclinaison). */
export type TextShadow = { x: number; y: number; blur: number; color: string; alpha: number }

/**
 * La lumière et les ombres d'un relief, de la plus haute à la plus basse (l'ordre de
 * `text-shadow`) : un relief sortant est éclairé du côté de la lumière, ombré de l'autre, et pose
 * son ombre portée ; un relief gravé, l'inverse (son bord du côté de la lumière est dans l'ombre).
 * La lumière vient de `reliefLight` degrés (0 en haut, 90 à droite).
 */
export function reliefShadows(zone: Pick<DocumentZone, "relief" | "reliefLight" | "reliefDepth" | "reliefSoftness" | "reliefContrast">): TextShadow[] {
  if (!zone.relief) return []
  const angle = ((zone.reliefLight ?? 315) * Math.PI) / 180
  const towardX = Math.sin(angle), towardY = -Math.cos(angle)
  const depth = zone.reliefDepth ?? 2
  const blur = zone.reliefSoftness ?? 1
  const strength = zone.reliefContrast ?? 0.6
  const at = (factor: number) => ({ x: n(towardX * depth * factor), y: n(towardY * depth * factor) })
  if (zone.relief === "engraved") return [
    { ...at(-0.5), blur, color: "#ffffff", alpha: strength },
    { ...at(0.5), blur, color: "#000000", alpha: strength },
  ]
  return [
    { ...at(0.5), blur, color: "#ffffff", alpha: strength },
    { ...at(-0.5), blur, color: "#000000", alpha: strength },
    { ...at(-1.4), blur: n(blur + depth), color: "#000000", alpha: n(strength * 0.45) },
  ]
}

/** Les ombres d'un relief en `text-shadow` (unités du document : la scène est agrandie d'un bloc). */
export function reliefShadowCss(shadows: TextShadow[]) {
  return shadows.map((shadow) => `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${withAlpha(shadow.color, shadow.alpha)}`).join(", ")
}

/** Les réglages d'un relief qu'on vient de choisir, à la mesure du texte de la zone. */
export function defaultRelief(zone: Pick<DocumentZone, "size">, relief: DocumentRelief) {
  const depth = Math.round(Math.max(1, zone.size * 0.04) * 10) / 10
  return { relief, reliefLight: 315, reliefDepth: depth, reliefSoftness: Math.round(depth * 5) / 10, reliefContrast: 0.6 }
}

/* ---------- lignes ---------- */

export function newDocumentLine(partial: Partial<DocumentLine> = {}): DocumentLine {
  return { id: crypto.randomUUID(), x1: 200, y1: 200, x2: 800, y2: 200, width: 3, color: DEFAULT_INK, style: "solid", opacity: 0.92, blend: "multiply", ...partial }
}

/** Les tirets d'une ligne, en unités de son épaisseur : les mêmes en SVG et dans le canvas. */
export function lineDash(style: DocumentLineStyle, width: number): number[] {
  if (style === "dashed") return [width * 3, width * 2]
  if (style === "dotted") return [0, width * 2]
  return []
}
export const lineCap = (style: DocumentLineStyle): CanvasLineCap => style === "dashed" ? "butt" : "round"

/* ---------- formes ---------- */

export const shapeKinds: ReadonlyArray<{ value: DocumentShapeKind; label: string }> = [
  { value: "rectangle", label: "Rectangle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Losange" },
  { value: "star", label: "Étoile" },
]

export function newDocumentShape(partial: Partial<DocumentShape> = {}): DocumentShape {
  return {
    id: crypto.randomUUID(), shape: "rectangle", x: 400, y: 400, width: 200, height: 140, rotation: 0, radius: 0,
    strokeWidth: 3, strokeColor: DEFAULT_INK, strokeStyle: "solid", fill: "none", fillColor: "#8b1a1a", fillColor2: "#f4ead6", fillOpacity2: 1, gradientAngle: 90,
    opacity: 0.92, blend: "multiply", ...partial,
  }
}

const n = (value: number) => Math.round(value * 100) / 100

/**
 * Le contour d'une forme dans sa boîte (de 0,0 à largeur,hauteur), en chemin SVG : le même dans la
 * scène (`<path d>`) et dans le rendu (`new Path2D(d)`).
 */
export function shapePath(shape: Pick<DocumentShape, "shape" | "width" | "height" | "radius">) {
  const w = shape.width, h = shape.height
  if (shape.shape === "ellipse") return `M0 ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(w)} ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 0 ${n(h / 2)}Z`
  if (shape.shape === "triangle") return `M${n(w / 2)} 0L${n(w)} ${n(h)}L0 ${n(h)}Z`
  if (shape.shape === "diamond") return `M${n(w / 2)} 0L${n(w)} ${n(h / 2)}L${n(w / 2)} ${n(h)}L0 ${n(h / 2)}Z`
  if (shape.shape === "star") {
    const points = Array.from({ length: 10 }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5
      const ratio = index % 2 ? 0.42 : 1
      return `${n(w / 2 + Math.cos(angle) * (w / 2) * ratio)} ${n(h / 2 + Math.sin(angle) * (h / 2) * ratio)}`
    })
    return `M${points.join("L")}Z`
  }
  const r = Math.max(0, Math.min(shape.radius, w / 2, h / 2))
  if (!r) return `M0 0H${n(w)}V${n(h)}H0Z`
  return `M${n(r)} 0H${n(w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)}V${n(h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)}H${n(r)}A${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)}V${n(r)}A${n(r)} ${n(r)} 0 0 1 ${n(r)} 0Z`
}

/** Les bouts d'un dégradé dans la boîte de la forme : les mêmes en SVG et dans le canvas. */
export function shapeGradient(shape: Pick<DocumentShape, "fill" | "width" | "height" | "gradientAngle">) {
  const cx = shape.width / 2, cy = shape.height / 2
  if (shape.fill === "radial") return { kind: "radial" as const, cx, cy, r: Math.max(1, Math.hypot(shape.width, shape.height) / 2) }
  const angle = (shape.gradientAngle * Math.PI) / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const half = Math.max(1, (Math.abs(shape.width * cos) + Math.abs(shape.height * sin)) / 2)
  return { kind: "linear" as const, x1: cx - cos * half, y1: cy - sin * half, x2: cx + cos * half, y2: cy + sin * half }
}

/** Une couleur « #rrggbb » à une opacité, pour le canvas. */
export function withAlpha(color: string, alpha: number) {
  const value = Number.parseInt(color.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/* ---------- calques de dessin ---------- */

/** Pixels d'un calque de dessin par unité du document : la finesse du rendu. */
export const DRAWING_SCALE = DOCUMENT_RENDER_WIDTH / DOCUMENT_WIDTH

/**
 * Un coup de plume, en pixels du calque. `points` : x, y et pression, à la suite. La pointe est une
 * ellipse : ronde quand `nib` vaut 0, de plus en plus plate jusqu'à 1 (plume calligraphique),
 * tenue à `angle` degrés. `erase` : la gomme.
 */
export type Stroke = { points: number[]; size: number; color: string; opacity: number; nib: number; angle: number; erase: boolean }

/** Le dessin d'un calque pas encore enregistré : sa taille en pixels et les coups ajoutés. */
export type Paint = { width: number; height: number; strokes: Stroke[] }

/** Dessine un coup de plume à partir du point `from` (un indice de point) : pour le tracé en direct. */
export function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, from = 0) {
  const { points, size } = stroke
  if (points.length < 3) return
  const angle = (stroke.angle * Math.PI) / 180
  // Le petit axe de la pointe : jamais moins de 12 % du grand, ni moins d'un demi-pixel.
  const flatness = Math.max(0.12, 1 - stroke.nib * 0.88)
  context.save()
  context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over"
  context.fillStyle = stroke.erase ? "#000" : stroke.color
  const stamp = (x: number, y: number, pressure: number) => {
    const rx = Math.max(0.5, (size / 2) * pressure)
    const ry = Math.max(0.5, rx * flatness)
    context.beginPath()
    context.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2)
    context.fill()
  }
  const start = Math.max(0, from) * 3
  if (start === 0) stamp(points[0], points[1], points[2])
  for (let index = Math.max(3, start); index < points.length; index += 3) {
    const x0 = points[index - 3], y0 = points[index - 2], p0 = points[index - 1]
    const x1 = points[index], y1 = points[index + 1], p1 = points[index + 2]
    const distance = Math.hypot(x1 - x0, y1 - y0)
    const step = Math.max(0.5, Math.min(size / 2, (size / 2) * flatness) * 0.35)
    const count = Math.max(1, Math.ceil(distance / step))
    for (let k = 1; k <= count; k += 1) {
      const t = k / count
      stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t)
    }
  }
  context.restore()
}

let scratch: HTMLCanvasElement | null = null

/** Les coups de plume d'un calque, chacun à son opacité (un coup ne fonce pas là où il se recroise). */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[]) {
  const { width, height } = context.canvas
  for (const stroke of strokes) {
    if (stroke.erase || stroke.opacity >= 1) { paintStroke(context, stroke); continue }
    scratch ??= document.createElement("canvas")
    if (scratch.width !== width || scratch.height !== height) { scratch.width = width; scratch.height = height }
    const layer = scratch.getContext("2d")
    if (!layer) continue
    layer.clearRect(0, 0, width, height)
    paintStroke(layer, stroke)
    context.save()
    context.globalAlpha = stroke.opacity
    context.drawImage(scratch, 0, 0)
    context.restore()
  }
}

/** Un calque de dessin aplati : son image d'avant (s'il en a une) et ses nouveaux coups de plume. */
export function flattenDrawing(base: CanvasImageSource | null, paint: Paint) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(paint.width))
  canvas.height = Math.max(1, Math.round(paint.height))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Le navigateur ne peut pas dessiner le document.")
  if (base) context.drawImage(base, 0, 0, canvas.width, canvas.height)
  paintStrokes(context, paint.strokes)
  return canvas
}

/** Un point du document dans le repère d'une image ou d'un calque (pixels), malgré sa place et son inclinaison. */
export function documentToPicture(picture: Pick<DocumentPicture, "x" | "y" | "width" | "height" | "rotation">, pixels: { width: number; height: number }, point: { x: number; y: number }) {
  const centerX = picture.x + picture.width / 2
  const centerY = picture.y + picture.height / 2
  const angle = (-picture.rotation * Math.PI) / 180
  const dx = point.x - centerX, dy = point.y - centerY
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle) + picture.width / 2
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle) + picture.height / 2
  return { x: localX * (pixels.width / picture.width), y: localY * (pixels.height / picture.height) }
}

/** L'adresse d'une pièce enregistrée (image posée, calque de dessin), comme `documentPartUrl` d'Eraser. */
export function pieceUrl(campaignId: string, documentId: string, asset: string, version = "") {
  const query = new URLSearchParams({ part: `piece-${asset}` })
  if (version) query.set("v", version.replace(/[^0-9A-Za-z]/g, ""))
  return `/api/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(documentId)}/image?${query}`
}
