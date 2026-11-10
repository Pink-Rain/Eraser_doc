import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  ArrowDownToLine, ArrowUpToLine, Bold, Check, Circle, Copy, CopyPlus, Diamond, Eraser, Eye, FileImage, FileText, Folder, Frame, ImagePlus, Italic,
  LayoutTemplate, Link2, LoaderCircle, Minus, MousePointer2, PenTool, Plus, Redo2, RotateCcw, Save, Shapes, Slash, Square, Star, Strikethrough, Trash2,
  Triangle, TriangleAlert, Type, Underline, Undo2, Upload,
} from "lucide-react"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DocumentViewerDialog, GiveDocumentButton, type ViewedDocument } from "@/components/eraser/document-viewer"
import { Range, Segmented, Toggle, fieldLabel, hintText } from "@/components/eraser/editor-controls"
import { replaceAppUrl } from "@/components/eraser/app-tabs"
import {
  DEFAULT_INK, DOCUMENT_RENDER_WIDTH, DOCUMENT_WIDTH, builtinBackgroundKeys, cleanDocumentContent, documentFontKeys,
  documentImageUrl, documentStudioHref,
  type BuiltinBackgroundKey, type CampaignDocumentRecord, type DocumentAlign, type DocumentBackground, type DocumentContent,
  type DocumentLine, type DocumentLineStyle, type DocumentParagraph, type DocumentPicture, type DocumentShape, type DocumentShapeFill, type DocumentShapeKind, type DocumentVerticalAlign, type DocumentZone,
} from "@/lib/document-model"
import { cn } from "@/lib/utils"

import { builtinBackgrounds, documentFonts, documentFromBuiltin, documentOnOwnBackground, newDocumentZone } from "./document-assets"
import {
  DRAWING_SCALE, flattenDrawing, shapeKinds, movedInOrder, newDocumentLine, newDocumentShape, normalizeContent, pieceUrl, withElementOnTop, withoutElement, zoneBlend,
  type Paint, type Stroke,
} from "./document-elements"
import { DocumentLibrary, folderNames } from "./document-library"
import { backgroundSource, loadDocumentFonts, loadImage, renderDocumentCanvas } from "./document-render"
import { DocumentStage, focusAt, zoneEditable, type BrushSettings, type LineSettings, type ShapeSettings, type StageTool } from "./document-stage"
import { paragraphsFromElement } from "./document-text"
import { BlendSelect, InkPicker, LayersPopover } from "./document-tools"
import { LARGE_REQUESTS, SMALL_REQUESTS, documentForms, fittedBackground, fittedBlob, partBudget, type DocumentPart } from "./document-upload"

/**
 * L'éditeur des documents (l'ancienne page Document d'Eraser) : les documents de la campagne
 * (parchemins, lettres, livres…), rangés en dossiers, et leur éditeur. On choisit un fond (fourni,
 * depuis l'ordinateur, une adresse ou un modèle), on pose des zones de texte, des lignes, des
 * formes (remplies, en dégradé), des images et des calques de dessin (plume calligraphique,
 * gomme), chacun avec son mode de fusion.
 * « Enregistrer » dessine le document : c'est cette image que reçoivent les joueurs (« Donner
 * à… ») et Roll20 (handout et PDF, par le compagnon).
 */

type Draft = {
  id: string
  isNew: boolean
  title: string
  sessionId: string
  folder: string
  template: boolean
  background: DocumentBackground
  content: DocumentContent
  /** Le fond choisi sur l'ordinateur, pas encore envoyé, et son aperçu. */
  uploadFile: File | null
  uploadPreview: string
  /** Les pièces (images posées, calques de dessin aplatis) pas encore envoyées, par nom. */
  uploads: Record<string, Blob>
  /** Les adresses à afficher pour des pièces (aperçus locaux, ou l'image d'un autre document). */
  previews: Record<string, string>
  /** Les pièces déjà rangées par Eraser avec ce document. */
  remote: string[]
  /** Les coups de plume pas encore enregistrés, par calque de dessin. */
  paint: Record<string, Paint>
  renderVersion: string
  updatedAt: string
}

type Snapshot = { content: DocumentContent; paint: Record<string, Paint> }
type Player = { id: string; name: string }
type Message = { tone: "ok" | "error"; text: string } | null

const strokeCount = (paint: Record<string, Paint>) => Object.entries(paint).map(([id, layer]) => `${id}:${layer.strokes.length}`).sort()
// Le dossier et le modèle s'enregistrent tout seuls (sans redessiner) : ils ne rendent pas le document « modifié ».
const signature = (draft: Draft | null) => draft ? JSON.stringify({ title: draft.title, sessionId: draft.sessionId, background: draft.background, content: draft.content, upload: draft.uploadFile ? `${draft.uploadFile.name}:${draft.uploadFile.size}` : "", uploads: Object.keys(draft.uploads).sort(), paint: strokeCount(draft.paint) }) : ""
const assetsOf = (content: DocumentContent) => [...new Set((content.pictures ?? []).map((picture) => picture.asset))]

function draftOf(document: CampaignDocumentRecord): Draft {
  const content = normalizeContent(document.content)
  return {
    id: document.id, isNew: false, title: document.title, sessionId: document.sessionId, folder: document.folder ?? "", template: Boolean(document.template),
    background: document.background, content, uploadFile: null, uploadPreview: "", uploads: {}, previews: {}, remote: assetsOf(content), paint: {},
    renderVersion: document.renderVersion, updatedAt: document.updatedAt,
  }
}

/** Le choix « Nouveau dossier… » du menu des dossiers (un nom de dossier ne commence jamais par un espace). */
const NEW_FOLDER = " nouveau"
const backupKey = (campaignId: string) => `eraser-document-draft:${campaignId}`
const toolsKey = "eraser-document-tools"

function readBackup(campaignId: string): (Draft & { savedAt: string }) | null {
  try {
    const raw = window.localStorage.getItem(backupKey(campaignId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Draft & { savedAt: string }
    if (!parsed?.id || parsed.background?.kind === "upload" && parsed.isNew) return null
    return { ...parsed, folder: parsed.folder ?? "", template: Boolean(parsed.template), content: normalizeContent(cleanDocumentContent(parsed.content)), uploadFile: null, uploadPreview: "", uploads: {}, previews: {}, remote: parsed.remote ?? [], paint: parsed.paint ?? {} }
  } catch { return null }
}

type ToolSettings = { brush: BrushSettings; line: LineSettings; shape: ShapeSettings }
/** Les réglages d'une forme neuve : tout sauf sa place. */
function shapeSettingsOf(shape: DocumentShape): ShapeSettings {
  return {
    shape: shape.shape, radius: shape.radius, strokeWidth: shape.strokeWidth, strokeColor: shape.strokeColor, strokeStyle: shape.strokeStyle,
    fill: shape.fill, fillColor: shape.fillColor, fillColor2: shape.fillColor2, fillOpacity2: shape.fillOpacity2, gradientAngle: shape.gradientAngle,
    opacity: shape.opacity, blend: shape.blend,
  }
}
const defaultTools: ToolSettings = {
  brush: { size: 4, color: DEFAULT_INK, opacity: 0.95, nib: 0.65, angle: 35, eraserSize: 24 },
  line: { width: 3, color: DEFAULT_INK, style: "solid", opacity: 0.92, blend: "multiply" },
  shape: shapeSettingsOf(newDocumentShape()),
}
function readTools(): ToolSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(toolsKey) || "null") as Partial<ToolSettings> | null
    return { brush: { ...defaultTools.brush, ...parsed?.brush }, line: { ...defaultTools.line, ...parsed?.line }, shape: { ...defaultTools.shape, ...parsed?.shape } }
  } catch { return defaultTools }
}

const shapeIcons: Record<DocumentShapeKind, ReactNode> = {
  rectangle: <Square className="size-3.5" />,
  ellipse: <Circle className="size-3.5" />,
  triangle: <Triangle className="size-3.5" />,
  diamond: <Diamond className="size-3.5" />,
  star: <Star className="size-3.5" />,
}

/** L'aperçu d'un remplissage (bouton du panneau des formes). */
function fillPreview(shape: ShapeSettings) {
  if (shape.fill === "none") return "transparent"
  if (shape.fill === "solid") return shape.fillColor
  const end = `color-mix(in srgb, ${shape.fillColor2} ${Math.round(shape.fillOpacity2 * 100)}%, transparent)`
  return shape.fill === "radial" ? `radial-gradient(circle, ${shape.fillColor}, ${end})` : `linear-gradient(${shape.gradientAngle + 90}deg, ${shape.fillColor}, ${end})`
}

/** Une image lue (aperçu d'une pièce, image posée) : sa taille naturelle. */
function imageSize(src: string) {
  return loadImage(src).then((image) => ({ width: image.naturalWidth || 400, height: image.naturalHeight || 300 }))
}

/* ---------- petits éléments ---------- */

function ToolButton({ label, active = false, disabled = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  // Garder la sélection du texte : le bouton ne prend pas le focus.
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick} className={cn("flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40", active && "bg-primary/12 text-primary")}>{children}</button>
}

function Separator() { return <span className="mx-0.5 h-6 w-px shrink-0 bg-border" /> }

function FontPicker({ value, onChange, disabled }: { value: DocumentZone["font"]; onChange: (font: DocumentZone["font"]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} className="flex h-8 min-w-36 items-center justify-between gap-2 rounded-md border bg-background px-2.5 text-sm disabled:opacity-40" title="Police de la zone">
        <span className="truncate" style={{ fontFamily: documentFonts[value].family }}>{documentFonts[value].label}</span><Type className="size-3.5 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 p-1.5" onOpenAutoFocus={(event) => event.preventDefault()}>
      {documentFontKeys.map((key) => <button key={key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(key); setOpen(false) }} className={cn("flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-accent", key === value && "bg-primary/10")}>
        <span className="truncate text-lg leading-7" style={{ fontFamily: documentFonts[key].family }}>{documentFonts[key].label}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{documentFonts[key].files.length ? "Eraser" : "Windows"}</span>
      </button>)}
    </PopoverContent>
  </Popover>
}

function NumberStepper({ value, min, max, step = 1, onChange, label, disabled, suffix = "" }: { value: number; min: number; max: number; step?: number; onChange: (value: number) => void; label: string; disabled?: boolean; suffix?: string }) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next * 10) / 10))
  return <span className="inline-flex h-8 items-center rounded-md border bg-background" title={label}>
    <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange(clamp(value - step))} className="flex h-full w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={`${label} : moins`}><Minus className="size-3" /></button>
    <input type="number" aria-label={label} disabled={disabled} value={Math.round(value * 10) / 10} min={min} max={max} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(clamp(next)) }} className="h-full w-12 border-x bg-transparent text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
    {suffix && <span className="pl-1 text-[11px] text-muted-foreground">{suffix}</span>}
    <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange(clamp(value + step))} className="flex h-full w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label={`${label} : plus`}><Plus className="size-3" /></button>
  </span>
}

/** Un aperçu de la pointe de la plume : son épaisseur selon la direction du trait. */
function NibPreview({ brush }: { brush: BrushSettings }) {
  const rx = 14
  const ry = Math.max(1.2, rx * Math.max(0.12, 1 - brush.nib * 0.88))
  return <svg viewBox="-20 -20 40 40" className="size-10 rounded-md border bg-background" aria-hidden>
    <ellipse cx={0} cy={0} rx={rx} ry={ry} transform={`rotate(${brush.angle})`} fill={brush.color} opacity={brush.opacity} />
  </svg>
}

/* ---------- choix du fond ---------- */

function BackgroundChoices({ onBuiltin, onFile, onUrl, compact = false }: { onBuiltin: (key: BuiltinBackgroundKey) => void; onFile: (file: File) => void; onUrl: (url: string) => void; compact?: boolean }) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  function submitUrl() {
    try {
      const parsed = new URL(url.trim())
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("PROTOCOL")
      setError("")
      onUrl(parsed.toString())
    } catch { setError("Colle l’adresse complète d’une image (https://…).") }
  }
  return <div className="grid gap-3">
    <div className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-3 sm:gap-3")}>
      {builtinBackgroundKeys.map((key) => <button key={key} type="button" onClick={() => onBuiltin(key)} className="group grid gap-1 rounded-xl border bg-card/60 p-1.5 text-center transition hover:border-primary/50 hover:bg-primary/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={builtinBackgrounds[key].src} alt="" loading="lazy" className="aspect-square w-full object-contain transition group-hover:scale-[1.03]" />
        <span className="text-xs font-medium">{builtinBackgrounds[key].label}</span>
      </button>)}
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed bg-background text-sm font-medium transition hover:border-primary/50 hover:bg-primary/5">
        <Upload className="size-4" />Image de l’ordinateur
        <input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { if (file.size > 15 * 1024 * 1024) setError("Cette image dépasse 15 Mo."); else onFile(file) } }} />
      </label>
      <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); submitUrl() }}>
        <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Adresse d’une image (https://…)" className="h-9 min-w-0 flex-1" />
        <Button type="submit" variant="outline" size="icon" title="Utiliser cette adresse" aria-label="Utiliser cette adresse" disabled={!url.trim()}><Link2 /></Button>
      </form>
    </div>
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>
}

/* ---------- la page ---------- */

export function DocumentStudio({ campaignId, initialDocuments, initialTemplates = [], features = [], sessions, players, initialDocumentId = "", initialSessionId = "", startNew = false }: {
  campaignId: string
  initialDocuments: CampaignDocumentRecord[]
  /** Les modèles du compte, dans toutes ses campagnes. */
  initialTemplates?: CampaignDocumentRecord[]
  /** Ce que le serveur d'Eraser sait garder (`dossiers`, `modeles`, `calques`). */
  features?: string[]
  sessions: Array<{ id: string; name: string }>
  players: Player[]
  initialDocumentId?: string
  initialSessionId?: string
  startNew?: boolean
}) {
  const layersOn = features.includes("calques")
  const shapesOn = features.includes("formes")
  const foldersOn = features.includes("dossiers")
  const templatesOn = features.includes("modeles")
  const [documents, setDocuments] = useState(initialDocuments)
  const [templates, setTemplates] = useState(initialTemplates)
  const [draft, setDraft] = useState<Draft | null>(() => {
    const found = initialDocuments.find((document) => document.id === initialDocumentId) ?? (startNew ? null : initialDocuments.at(-1))
    return found ? draftOf(found) : null
  })
  const [savedSignature, setSavedSignature] = useState(() => signature(draft))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [contentKeys, setContentKeys] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] })
  const [scale, setScale] = useState(0.6)
  const [showFrames, setShowFrames] = useState(true)
  const [overflowing, setOverflowing] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<"" | "render" | "upload">("")
  const [message, setMessage] = useState<Message>(null)
  const [choosing, setChoosing] = useState(startNew || (!initialDocuments.length && !initialDocumentId))
  const [changingBackground, setChangingBackground] = useState(false)
  const [viewing, setViewing] = useState<ViewedDocument | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null)
  const [formats, setFormats] = useState({ bold: false, italic: false, underline: false, strike: false })
  const [backup, setBackup] = useState<(Draft & { savedAt: string }) | null>(null)
  const [tool, setTool] = useState<StageTool>("select")
  const [tools, setTools] = useState<ToolSettings>(defaultTools)
  const [emptyFolders, setEmptyFolders] = useState<string[]>([])
  const [newFolderFor, setNewFolderFor] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const lastHistory = useRef({ key: "", at: 0 })
  const focusSnapshot = useRef<{ id: string; snapshot: Snapshot; text: string } | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const dirty = Boolean(draft) && signature(draft) !== savedSignature
  const zones = useMemo(() => draft?.content.zones ?? [], [draft])
  const selectedZone = zones.find((zone) => zone.id === selectedId) ?? null
  const selectedLine = draft?.content.lines.find((line) => line.id === selectedId) ?? null
  const selectedPicture = draft?.content.pictures.find((picture) => picture.id === selectedId) ?? null
  const selectedShape = draft?.content.shapes.find((shape) => shape.id === selectedId) ?? null
  const anySelected = Boolean(selectedZone || selectedLine || selectedPicture || selectedShape)
  const sessionName = (id: string) => sessions.find((session) => session.id === id)?.name ?? ""
  const folders = folderNames(documents, emptyFolders)
  const lineControls = selectedLine ?? (tool === "line" ? { ...tools.line } : null)
  const shapeControls: ShapeSettings | null = selectedShape ?? (tool === "shape" ? tools.shape : null)

  useEffect(() => { void loadDocumentFonts() }, [])
  useEffect(() => { queueMicrotask(() => setTools(readTools())) }, [])
  useEffect(() => {
    try { window.localStorage.setItem(toolsKey, JSON.stringify(tools)) } catch { /* stockage plein */ }
  }, [tools])

  // Un brouillon non enregistré (application fermée, page quittée) : proposé à la réouverture.
  useEffect(() => {
    const found = readBackup(campaignId)
    if (found) queueMicrotask(() => setBackup(found))
  }, [campaignId])
  useEffect(() => {
    if (!draft || !dirty) return
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(backupKey(campaignId), JSON.stringify({ ...draft, uploadFile: null, uploadPreview: "", uploads: {}, previews: {}, savedAt: new Date().toISOString() }))
      } catch { /* stockage plein : le brouillon n'est pas gardé */ }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [campaignId, dirty, draft])

  // Le gras, l'italique… de la sélection, montrés dans la barre d'outils.
  useEffect(() => {
    if (!editingId) return
    const update = () => setFormats({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), underline: document.queryCommandState("underline"), strike: document.queryCommandState("strikeThrough") })
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [editingId])

  // L'adresse de la page suit le document ouvert : « Actualiser » y revient.
  const openedId = draft && !draft.isNew ? draft.id : ""
  useEffect(() => {
    if (openedId) replaceAppUrl(documentStudioHref(campaignId, { document: openedId }))
  }, [campaignId, openedId])

  /* ----- modifier, avec annuler ----- */

  const snapshotOf = (current: Draft): Snapshot => ({ content: current.content, paint: current.paint })

  const remember = useCallback((before: Snapshot, key = "") => {
    const now = Date.now()
    // Plusieurs pas d'un même réglage (un curseur qu'on fait glisser) : un seul retour en arrière.
    if (key && lastHistory.current.key === key && now - lastHistory.current.at < 900) { lastHistory.current.at = now; return }
    lastHistory.current = { key, at: now }
    setHistory((current) => ({ past: [...current.past.slice(-59), before], future: [] }))
  }, [])

  const changeContent = useCallback((next: (content: DocumentContent) => DocumentContent, history: boolean | string = true, id = "") => {
    if (history && draft) remember(snapshotOf(draft), typeof history === "string" ? `${history}:${id}` : "")
    setDraft((current) => current && { ...current, content: next(current.content) })
  }, [draft, remember])

  const changeZone = useCallback((id: string, next: (zone: DocumentZone) => DocumentZone, history: boolean | string) => {
    changeContent((content) => ({ ...content, zones: content.zones.map((zone) => zone.id === id ? next(zone) : zone) }), history, id)
  }, [changeContent])
  const changeLine = useCallback((id: string, next: (line: DocumentLine) => DocumentLine, history: boolean | string) => {
    changeContent((content) => ({ ...content, lines: content.lines.map((line) => line.id === id ? next(line) : line) }), history, id)
  }, [changeContent])
  const changePicture = useCallback((id: string, next: (picture: DocumentPicture) => DocumentPicture, history: boolean | string) => {
    changeContent((content) => ({ ...content, pictures: content.pictures.map((picture) => picture.id === id ? next(picture) : picture) }), history, id)
  }, [changeContent])
  const changeShape = useCallback((id: string, next: (shape: DocumentShape) => DocumentShape, history: boolean | string) => {
    changeContent((content) => ({ ...content, shapes: content.shapes.map((shape) => shape.id === id ? next(shape) : shape) }), history, id)
  }, [changeContent])

  /** Un état repris d'ailleurs (annuler, refaire) : le texte des zones changées est reposé dans la page. */
  function applySnapshot(snapshot: Snapshot) {
    if (!draft) return
    const before = new Map(draft.content.zones.map((zone) => [zone.id, JSON.stringify(zone.paragraphs)]))
    setContentKeys((keys) => {
      const updated = { ...keys }
      for (const zone of snapshot.content.zones) if (before.get(zone.id) !== JSON.stringify(zone.paragraphs)) updated[zone.id] = (updated[zone.id] ?? 0) + 1
      return updated
    })
    setDraft((current) => current && { ...current, content: snapshot.content, paint: snapshot.paint })
    if (selectedId && !snapshot.content.order.includes(selectedId)) setSelectedId(null)
  }

  function undo() {
    if (!draft || !history.past.length) return
    const previous = history.past[history.past.length - 1]
    setHistory({ past: history.past.slice(0, -1), future: [snapshotOf(draft), ...history.future].slice(0, 60) })
    lastHistory.current = { key: "", at: 0 }
    applySnapshot(previous)
  }
  function redo() {
    if (!draft || !history.future.length) return
    const [next, ...rest] = history.future
    setHistory({ past: [...history.past, snapshotOf(draft)].slice(-60), future: rest })
    lastHistory.current = { key: "", at: 0 }
    applySnapshot(next)
  }

  const zoneText = useCallback((id: string, paragraphs: DocumentParagraph[]) => {
    setDraft((current) => current && { ...current, content: { ...current.content, zones: current.content.zones.map((zone) => zone.id === id ? { ...zone, paragraphs } : zone) } })
  }, [])

  const editing = useCallback((id: string | null) => {
    if (id && draft) {
      const zone = draft.content.zones.find((candidate) => candidate.id === id)
      focusSnapshot.current = { id, snapshot: snapshotOf(draft), text: JSON.stringify(zone?.paragraphs ?? []) }
    } else if (!id && focusSnapshot.current && draft) {
      // Le texte écrit d'une traite compte pour un seul retour en arrière.
      const before = focusSnapshot.current
      const zone = draft.content.zones.find((candidate) => candidate.id === before.id)
      if (zone && JSON.stringify(zone.paragraphs) !== before.text) {
        lastHistory.current = { key: "", at: 0 }
        setHistory((current) => ({ past: [...current.past.slice(-59), before.snapshot], future: [] }))
      }
      focusSnapshot.current = null
    }
    setEditingId(id)
  }, [draft])

  const overflow = useCallback((id: string, value: boolean) => setOverflowing((current) => current[id] === value ? current : { ...current, [id]: value }), [])

  const backgroundSize = useCallback((width: number, height: number) => {
    if (!(width > 0 && height > 0)) return
    const next = Math.min(DOCUMENT_WIDTH * 4, Math.max(DOCUMENT_WIDTH * 0.2, Math.round((DOCUMENT_WIDTH * height / width) * 10) / 10))
    setDraft((current) => current && Math.abs(current.content.height - next) > 0.5 ? { ...current, content: { ...current.content, height: next } } : current)
  }, [])

  /** L'image d'une pièce : son aperçu local, sinon celle qu'Eraser a rangée avec le document. */
  const pictureSrc = useCallback((asset: string) => {
    if (!draft) return ""
    if (draft.previews[asset]) return draft.previews[asset]
    return draft.remote.includes(asset) && !draft.isNew ? pieceUrl(campaignId, draft.id, asset, draft.updatedAt) : ""
  }, [campaignId, draft])

  /* ----- outils ----- */

  function chooseTool(next: StageTool) {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    setTool(next)
    // La plume et la gomme travaillent dans le calque de dessin choisi : un autre choix est oublié.
    if ((next === "brush" || next === "eraser") && selectedPicture?.kind !== "drawing") setSelectedId(null)
    // La ligne et la forme : leurs réglages valent pour le prochain tracé.
    if (next === "line" || next === "shape") setSelectedId(null)
  }
  const setBrush = (patch: Partial<BrushSettings>) => setTools((current) => ({ ...current, brush: { ...current.brush, ...patch } }))
  /** Les réglages d'une ligne : ceux de la ligne choisie, et ceux des prochaines lignes. */
  function setLine(patch: Partial<LineSettings>, key: string) {
    setTools((current) => ({ ...current, line: { ...current.line, ...patch } }))
    if (selectedLine) changeLine(selectedLine.id, (line) => ({ ...line, ...patch }), key)
  }

  /** Les réglages d'une forme : ceux de la forme choisie, et ceux des prochaines formes. */
  function setShape(patch: Partial<ShapeSettings>, key: string) {
    setTools((current) => ({ ...current, shape: { ...current.shape, ...patch } }))
    if (selectedShape) changeShape(selectedShape.id, (shape) => ({ ...shape, ...patch }), key)
  }

  /* ----- éléments ----- */

  function addZone(rect?: { x: number; y: number; width: number; height: number }) {
    if (!draft) return
    // La nouvelle zone reprend le style de la zone choisie (police, taille, encre).
    const model = selectedZone ?? zones.at(-1)
    const zone = newDocumentZone({
      ...(model ? { font: model.font, size: model.size, color: model.color, lineHeight: model.lineHeight, opacity: model.opacity, ink: model.ink, align: model.align, ...(model.blend ? { blend: model.blend } : {}) } : {}),
      ...(rect ?? { x: DOCUMENT_WIDTH / 2 - 250, y: draft.content.height / 2 - 70, width: 500, height: 140 }),
      paragraphs: rect ? [] : [[{ text: "Nouveau texte" }]],
    })
    changeContent((content) => withElementOnTop(content, { kind: "zone", id: zone.id, zone }))
    setTool("select")
    setSelectedId(zone.id)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = zoneEditable(zone.id)
      if (!element) return
      focusAt(element, null)
      if (!rect) document.execCommand("selectAll")
    }))
  }

  function addLine(coordinates: Pick<DocumentLine, "x1" | "y1" | "x2" | "y2">) {
    const line = newDocumentLine({ ...tools.line, ...coordinates })
    changeContent((content) => withElementOnTop(content, { kind: "line", id: line.id, line }))
    // Tracée, la ligne est choisie : ses réglages s'appliquent à elle (L : en tracer une autre).
    setTool("select")
    setSelectedId(line.id)
  }

  function addShape(rect: { x: number; y: number; width: number; height: number }) {
    const shape = newDocumentShape({ ...tools.shape, ...rect })
    changeContent((content) => withElementOnTop(content, { kind: "shape", id: shape.id, shape }))
    // Tracée, la forme est choisie : ses réglages s'appliquent à elle (F : en tracer une autre).
    setTool("select")
    setSelectedId(shape.id)
  }

  async function addImage(file: File) {
    if (!draft) return
    if (file.size > 15 * 1024 * 1024) { setMessage({ tone: "error", text: "Cette image dépasse 15 Mo." }); return }
    const preview = URL.createObjectURL(file)
    try {
      const size = await imageSize(preview)
      // Posée au milieu, au plus la moitié du document.
      const fit = Math.min(1, (DOCUMENT_WIDTH * 0.5) / size.width, (draft.content.height * 0.5) / size.height)
      const width = Math.max(20, size.width * fit), height = Math.max(20, size.height * fit)
      const asset = crypto.randomUUID()
      const picture: DocumentPicture = { id: crypto.randomUUID(), kind: "image", asset, x: (DOCUMENT_WIDTH - width) / 2, y: (draft.content.height - height) / 2, width, height, rotation: 0, opacity: 1, blend: "normal" }
      remember(snapshotOf(draft))
      setDraft((current) => current && { ...current, content: withElementOnTop(current.content, { kind: "picture", id: picture.id, picture }), uploads: { ...current.uploads, [asset]: file }, previews: { ...current.previews, [asset]: preview } })
      setTool("select")
      setSelectedId(picture.id)
    } catch {
      URL.revokeObjectURL(preview)
      setMessage({ tone: "error", text: "Cette image n’a pas pu être lue (format inconnu ?)." })
    }
  }

  /** Un coup de plume ou de gomme fini, dans son calque (un nouveau calque de la page s'il n'en avait pas). */
  const stroke = useCallback((target: string | null, done: Stroke, pixels: { width: number; height: number }, geometry: { x: number; y: number; width: number; height: number; rotation: number }) => {
    if (!draft) return
    remember(snapshotOf(draft))
    if (target === null) {
      const picture: DocumentPicture = { id: crypto.randomUUID(), kind: "drawing", asset: crypto.randomUUID(), ...geometry, opacity: 1, blend: "normal" }
      setDraft((current) => current && { ...current, content: withElementOnTop(current.content, { kind: "picture", id: picture.id, picture }), paint: { ...current.paint, [picture.id]: { width: pixels.width, height: pixels.height, strokes: [done] } } })
      setSelectedId(picture.id)
      return
    }
    setDraft((current) => {
      if (!current) return current
      const layer = current.paint[target]
      return { ...current, paint: { ...current.paint, [target]: { width: layer?.width ?? pixels.width, height: layer?.height ?? pixels.height, strokes: [...(layer?.strokes ?? []), done] } } }
    })
  }, [draft, remember])

  function duplicateElement() {
    if (!draft || !selectedId) return
    const offset = 24
    if (selectedZone) {
      const zone = { ...selectedZone, id: crypto.randomUUID(), x: selectedZone.x + offset, y: selectedZone.y + offset }
      changeContent((content) => withElementOnTop(content, { kind: "zone", id: zone.id, zone }))
      setSelectedId(zone.id)
    } else if (selectedLine) {
      const line = { ...selectedLine, id: crypto.randomUUID(), x1: selectedLine.x1 + offset, y1: selectedLine.y1 + offset, x2: selectedLine.x2 + offset, y2: selectedLine.y2 + offset }
      changeContent((content) => withElementOnTop(content, { kind: "line", id: line.id, line }))
      setSelectedId(line.id)
    } else if (selectedShape) {
      const shape = { ...selectedShape, id: crypto.randomUUID(), x: selectedShape.x + offset, y: selectedShape.y + offset }
      changeContent((content) => withElementOnTop(content, { kind: "shape", id: shape.id, shape }))
      setSelectedId(shape.id)
    } else if (selectedPicture) {
      // Une image garde son fichier ; un calque de dessin en a un à lui (il sera dessiné à part).
      const asset = selectedPicture.kind === "drawing" ? crypto.randomUUID() : selectedPicture.asset
      const picture = { ...selectedPicture, id: crypto.randomUUID(), asset, x: selectedPicture.x + offset, y: selectedPicture.y + offset }
      const base = pictureSrc(selectedPicture.asset)
      const layer = draft.paint[selectedPicture.id]
      remember(snapshotOf(draft))
      setDraft((current) => current && {
        ...current,
        content: withElementOnTop(current.content, { kind: "picture", id: picture.id, picture }),
        previews: asset !== selectedPicture.asset && base ? { ...current.previews, [asset]: base } : current.previews,
        uploads: asset !== selectedPicture.asset && current.uploads[selectedPicture.asset] ? { ...current.uploads, [asset]: current.uploads[selectedPicture.asset] } : current.uploads,
        paint: layer ? { ...current.paint, [picture.id]: { ...layer, strokes: [...layer.strokes] } } : current.paint,
      })
      setSelectedId(picture.id)
    }
  }

  function deleteElement() {
    if (!selectedId) return
    changeContent((content) => withoutElement(content, selectedId))
    setSelectedId(null)
  }

  function moveLayer(id: string, move: 1 | -1 | "top" | "bottom") {
    changeContent((content) => movedInOrder(content, id, move))
  }

  const patchZone = (patch: Partial<DocumentZone>, key: string) => { if (selectedZone) changeZone(selectedZone.id, (zone) => ({ ...zone, ...patch }), key) }
  const patchPicture = (patch: Partial<DocumentPicture>, key: string) => { if (selectedPicture) changePicture(selectedPicture.id, (picture) => ({ ...picture, ...patch }), key) }
  const patchBox = (patch: { rotation: number }, key: string) => {
    if (selectedPicture) patchPicture(patch, key)
    else if (selectedShape) changeShape(selectedShape.id, (shape) => ({ ...shape, ...patch }), key)
  }

  /**
   * Gras, italique, souligné, barré, couleur : sur le texte choisi, ou sur toute la zone quand
   * rien n'est choisi dedans.
   */
  function format(command: "bold" | "italic" | "underline" | "strikeThrough" | "foreColor", value?: string) {
    if (!selectedZone || !draft) return
    const element = zoneEditable(selectedZone.id)
    if (!element) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const inside = Boolean(range && !range.collapsed && element.contains(range.commonAncestorContainer))
    if (!inside && command === "foreColor" && value) {
      // Rien de choisi : la couleur de l'encre de toute la zone (le texte coloré à part le reste).
      patchZone({ color: value }, "color")
      return
    }
    const before = snapshotOf(draft)
    if (!inside) {
      element.focus({ preventScroll: true })
      const all = document.createRange()
      all.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(all)
    }
    document.execCommand("styleWithCSS", false, "false")
    document.execCommand(command, false, value)
    remember(before)
    zoneText(selectedZone.id, paragraphsFromElement(element))
    if (!inside) selection?.collapseToEnd()
    setFormats({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), underline: document.queryCommandState("underline"), strike: document.queryCommandState("strikeThrough") })
  }

  /* ----- clavier ----- */

  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); return }
      if (target?.isContentEditable && event.key === "Escape") { target.blur(); return }
      if (typing || !draft) return
      // Échap ferme d'abord un menu ouvert (couleurs, réglages…), sans rien désélectionner.
      if (event.key === "Escape" && document.querySelector("[data-radix-popper-content-wrapper], [role='dialog'], [role='alertdialog']")) return
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return }
      if (!mod && !event.altKey && layersOn) {
        const shortcut: Record<string, StageTool> = { v: "select", l: "line", f: "shape", p: "brush", e: "eraser" }
        const next = shortcut[event.key.toLowerCase()]
        if (next) { event.preventDefault(); chooseTool(next); return }
      }
      if (event.key === "Escape" && tool !== "select") { setTool("select"); return }
      if (!anySelected || !selectedId) return
      if (mod && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateElement(); return }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteElement(); return }
      if (event.key === "Enter" && selectedZone) { event.preventDefault(); const element = zoneEditable(selectedZone.id); if (element) focusAt(element, null); return }
      if (event.key === "Escape") { setSelectedId(null); return }
      const step = event.shiftKey ? 10 : 1
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const move = moves[event.key]
      if (!move) return
      event.preventDefault()
      if (selectedZone) changeZone(selectedId, (zone) => ({ ...zone, x: zone.x + move[0], y: zone.y + move[1] }), "nudge")
      else if (selectedPicture) changePicture(selectedId, (picture) => ({ ...picture, x: picture.x + move[0], y: picture.y + move[1] }), "nudge")
      else if (selectedShape) changeShape(selectedId, (shape) => ({ ...shape, x: shape.x + move[0], y: shape.y + move[1] }), "nudge")
      else if (selectedLine) changeLine(selectedId, (line) => ({ ...line, x1: line.x1 + move[0], y1: line.y1 + move[1], x2: line.x2 + move[0], y2: line.y2 + move[1] }), "nudge")
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })

  /* ----- ouvrir, créer, copier ----- */

  function guard(action: () => void) {
    if (dirty) setPendingSwitch(() => action)
    else action()
  }

  function releasePreviews(current: Draft | null) {
    if (!current) return
    if (current.uploadPreview) URL.revokeObjectURL(current.uploadPreview)
    for (const url of Object.values(current.previews)) if (url.startsWith("blob:")) URL.revokeObjectURL(url)
  }

  function resetEditing() {
    setSelectedId(null); setEditingId(null); setHistory({ past: [], future: [] }); setOverflowing({}); setMessage(null); setTool("select")
    setContentKeys((keys) => Object.fromEntries(Object.entries(keys).map(([id, value]) => [id, value + 1])))
  }

  function open(document: CampaignDocumentRecord) {
    guard(() => {
      releasePreviews(draft)
      const next = draftOf(document)
      resetEditing()
      setDraft(next)
      setSavedSignature(signature(next))
    })
  }

  const startingSession = initialSessionId && sessions.some((session) => session.id === initialSessionId) ? initialSessionId : ""

  function create(background: DocumentBackground, file?: File) {
    const content = background.kind === "builtin" ? documentFromBuiltin(background.key) : documentOnOwnBackground()
    const next: Draft = {
      id: crypto.randomUUID(), isNew: true, title: "Nouveau document", sessionId: startingSession, folder: "", template: false,
      background, content, uploadFile: file ?? null, uploadPreview: file ? URL.createObjectURL(file) : "", uploads: {}, previews: {}, remote: [], paint: {},
      renderVersion: "", updatedAt: "",
    }
    releasePreviews(draft)
    resetEditing()
    setDraft(next)
    setSavedSignature("")
    setChoosing(false)
  }

  /**
   * Un nouveau document copié d'un autre (dupliquer) ou d'un modèle : son contenu, et ses images
   * (fond importé, images posées, calques de dessin) relues chez Eraser pour être renvoyées avec
   * la copie. La copie attend d'être enregistrée.
   */
  async function copyOf(source: CampaignDocumentRecord, title: string, folder: string) {
    setCopying(true)
    setMessage(null)
    const made: string[] = []
    const blobOf = async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error("COPY_IMAGE_MISSING")
      return response.blob()
    }
    try {
      const content = normalizeContent(structuredClone(source.content))
      const uploads: Record<string, Blob> = {}
      const previews: Record<string, string> = {}
      for (const asset of assetsOf(content)) {
        const blob = await blobOf(pieceUrl(source.campaignId, source.id, asset, source.updatedAt))
        uploads[asset] = blob
        previews[asset] = URL.createObjectURL(blob)
        made.push(previews[asset])
      }
      let uploadFile: File | null = null
      if (source.background.kind === "upload") {
        const blob = await blobOf(`/api/campaigns/${encodeURIComponent(source.campaignId)}/documents/${encodeURIComponent(source.id)}/image?part=fond&v=${encodeURIComponent(source.updatedAt.replace(/[^0-9A-Za-z]/g, ""))}`)
        uploadFile = new File([blob], "fond", { type: blob.type || "image/webp" })
      }
      // Les éléments gardent leurs noms, mais le document en a un neuf.
      const next: Draft = {
        id: crypto.randomUUID(), isNew: true, title: title.slice(0, 160), sessionId: startingSession, folder, template: false,
        background: source.background, content, uploadFile, uploadPreview: uploadFile ? URL.createObjectURL(uploadFile) : "", uploads, previews, remote: [], paint: {},
        renderVersion: "", updatedAt: "",
      }
      releasePreviews(draft)
      resetEditing()
      setDraft(next)
      setSavedSignature("")
      setChoosing(false)
      setMessage({ tone: "ok", text: "Copie prête : renomme-la si besoin, puis enregistre-la." })
    } catch {
      for (const url of made) URL.revokeObjectURL(url)
      setMessage({ tone: "error", text: "La copie n’a pas pu être faite : une image du document n’a pas pu être relue. Réessaie dans un instant." })
    } finally {
      setCopying(false)
    }
  }

  function duplicateDocument() {
    const source = draft && documents.find((document) => document.id === draft.id)
    if (!source) return
    void copyOf(source, `${source.title} (copie)`, source.folder ?? "")
  }

  function fromTemplate(template: CampaignDocumentRecord) {
    guard(() => { void copyOf(template, template.title, "") })
  }

  function changeBackground(background: DocumentBackground, file?: File) {
    if (!draft) return
    if (draft.uploadPreview) URL.revokeObjectURL(draft.uploadPreview)
    setDraft({ ...draft, background, uploadFile: file ?? null, uploadPreview: file ? URL.createObjectURL(file) : "" })
    setChangingBackground(false)
  }

  function restoreBackup() {
    if (!backup) return
    const original = documents.find((document) => document.id === backup.id)
    const remote = original ? assetsOf(normalizeContent(original.content)) : []
    // Les images pas encore envoyées n'ont pas pu être gardées : elles ne reviennent pas.
    const lost = backup.content.pictures.filter((picture) => !remote.includes(picture.asset)).map((picture) => picture.id)
    let content = backup.content
    for (const id of lost) content = withoutElement(content, id)
    const restored: Draft = { ...backup, content, remote, paint: Object.fromEntries(Object.entries(backup.paint).filter(([id]) => !lost.includes(id))), isNew: !original, updatedAt: original?.updatedAt ?? backup.updatedAt }
    releasePreviews(draft)
    resetEditing()
    setDraft(restored)
    setSavedSignature(original ? signature(draftOf(original)) : "")
    setBackup(null)
    if (lost.length) setMessage({ tone: "error", text: "Les images ajoutées à ce brouillon n’avaient pas été enregistrées : remets-les." })
  }
  function dropBackup() {
    try { window.localStorage.removeItem(backupKey(campaignId)) } catch { /* rien à effacer */ }
    setBackup(null)
  }

  /* ----- dossiers et modèles ----- */

  /** Range un document sans le redessiner (dossier, modèle) : tout de suite chez Eraser s'il y est déjà. */
  async function place(document: { id: string; isNew?: boolean }, change: { folder?: string; template?: boolean }) {
    if (document.isNew) {
      setDraft((current) => current && current.id === document.id ? { ...current, ...change } : current)
      return
    }
    const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(document.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }).catch(() => null)
    const payload = (await response?.json().catch(() => ({})) ?? {}) as { document?: CampaignDocumentRecord; error?: string }
    if (!response?.ok || !payload.document) { setMessage({ tone: "error", text: payload.error || "Le document n’a pas pu être rangé. Réessaie dans un instant." }); return }
    const stored = payload.document
    setDocuments((current) => current.map((candidate) => candidate.id === stored.id ? stored : candidate))
    setDraft((current) => current && current.id === stored.id ? { ...current, folder: stored.folder ?? "", template: Boolean(stored.template), updatedAt: stored.updatedAt } : current)
    if (change.template !== undefined) setTemplates((current) => stored.template ? [...current.filter((template) => template.id !== stored.id), stored].sort((left, right) => left.title.localeCompare(right.title, "fr")) : current.filter((template) => template.id !== stored.id))
    if (change.folder) setEmptyFolders((current) => current.filter((name) => name !== change.folder))
  }

  function moveToFolder(document: CampaignDocumentRecord, folder: string) {
    const previous = document.folder ?? ""
    // Le dossier quitté reste visible ici s'il se vide : on peut y ranger autre chose.
    if (previous && !documents.some((candidate) => candidate.id !== document.id && candidate.folder === previous)) setEmptyFolders((current) => [...new Set([...current, previous])])
    void place(document, { folder })
  }

  async function renameFolder(from: string, to: string) {
    setEmptyFolders((current) => current.map((name) => name === from ? to : name))
    for (const document of documents.filter((candidate) => candidate.folder === from)) await place(document, { folder: to })
    setDraft((current) => current && current.isNew && current.folder === from ? { ...current, folder: to } : current)
  }

  async function deleteFolder(name: string) {
    setEmptyFolders((current) => current.filter((candidate) => candidate !== name))
    for (const document of documents.filter((candidate) => candidate.folder === name)) await place(document, { folder: "" })
    setDraft((current) => current && current.isNew && current.folder === name ? { ...current, folder: "" } : current)
  }

  function chooseFolder(value: string) {
    if (!draft) return
    if (value === NEW_FOLDER) { setNewFolderFor(""); return }
    void place(draft, { folder: value })
  }

  /* ----- enregistrer ----- */

  const backgroundSrc = draft ? backgroundSource(draft.background, draft.uploadPreview || documentBackgroundUrl(campaignId, draft)) : ""

  async function save() {
    if (!draft || saving) return
    const snapshot = draft
    setSaving("render"); setMessage(null)
    try {
      const image = backgroundSrc ? await loadImage(backgroundSrc) : null
      const documentJson = JSON.stringify({ id: snapshot.id, title: snapshot.title, sessionId: snapshot.sessionId, background: snapshot.background, content: snapshot.content, folder: snapshot.folder, template: snapshot.template })
      // Chaque image tient dans un envoi (Eraser refuse plus de 1 Mo par envoi : document-upload.ts).
      // Un seul envoi quand Eraser l'accepte ; sinon, des envois de 1 Mo au plus.
      const requestLimit = features.includes("envoi-unique") ? LARGE_REQUESTS : SMALL_REQUESTS
      const budget = partBudget(documentJson, requestLimit)
      // Les images importées restent légères (l'éditeur les relit à chaque ouverture).
      const imageBudget = Math.min(budget, 4 * 1024 * 1024)

      // Les calques de dessin touchés (ou pas encore chez Eraser) sont aplatis en une image.
      const uploads = { ...snapshot.uploads }
      const previews = { ...snapshot.previews }
      const flattened: Record<string, number> = {}
      for (const picture of snapshot.content.pictures) {
        if (picture.kind !== "drawing") continue
        const layer = snapshot.paint[picture.id]
        const touched = Boolean(layer?.strokes.length)
        if (!touched && (snapshot.remote.includes(picture.asset) || uploads[picture.asset])) continue
        const src = previews[picture.asset] || (snapshot.remote.includes(picture.asset) && !snapshot.isNew ? pieceUrl(campaignId, snapshot.id, picture.asset, snapshot.updatedAt) : "")
        const base = src ? await loadImage(src).catch(() => null) : null
        const canvas = flattenDrawing(base, layer ?? { width: base?.naturalWidth || picture.width * DRAWING_SCALE, height: base?.naturalHeight || picture.height * DRAWING_SCALE, strokes: [] })
        const blob = await fittedBlob(canvas, "image/webp", [0.92, 0.85, 0.75], imageBudget)
        uploads[picture.asset] = blob
        if (previews[picture.asset]?.startsWith("blob:")) URL.revokeObjectURL(previews[picture.asset])
        previews[picture.asset] = URL.createObjectURL(blob)
        flattened[picture.id] = layer?.strokes.length ?? 0
      }
      if (Object.keys(flattened).length) {
        // Les coups aplatis sont dans l'image : annuler ne peut plus les retirer un à un.
        setDraft((current) => current && current.id === snapshot.id ? {
          ...current, uploads: { ...current.uploads, ...Object.fromEntries(Object.keys(uploads).filter((asset) => !snapshot.uploads[asset]).map((asset) => [asset, uploads[asset]])) },
          previews: { ...current.previews, ...previews },
          paint: Object.fromEntries(Object.entries(current.paint).flatMap(([id, layer]) => flattened[id] === undefined ? [[id, layer]] : layer.strokes.length > flattened[id] ? [[id, { ...layer, strokes: layer.strokes.slice(flattened[id]) }]] : [])),
        } : current)
        setHistory({ past: [], future: [] })
      }

      // Les images des pièces, pour le rendu.
      const pictures = new Map<string, HTMLImageElement>()
      for (const asset of assetsOf(snapshot.content)) {
        const src = previews[asset] || (snapshot.remote.includes(asset) && !snapshot.isNew ? pieceUrl(campaignId, snapshot.id, asset, snapshot.updatedAt) : "")
        const loaded = src ? await loadImage(src).catch(() => null) : null
        if (loaded) pictures.set(asset, loaded)
      }
      const render = await fittedBlob(await renderDocumentCanvas(snapshot.content, image, DOCUMENT_RENDER_WIDTH, "", pictures), "image/webp", [0.9, 0.8, 0.7], budget)
      const print = await fittedBlob(await renderDocumentCanvas(snapshot.content, image, DOCUMENT_RENDER_WIDTH, "#ffffff", pictures), "image/jpeg", [0.9, 0.8, 0.7], budget)
      const background = snapshot.uploadFile ? await fittedBackground(snapshot.uploadFile, imageBudget) : null
      const pieces: DocumentPart[] = []
      for (const asset of assetsOf(snapshot.content)) {
        // Seules les pièces nouvelles ou redessinées partent ; les autres sont déjà chez Eraser.
        const pending = uploads[asset]
        if (!pending) continue
        const file = pending instanceof File ? pending : new File([pending], `${asset}.webp`, { type: pending.type || "image/webp" })
        pieces.push({ field: `piece-${asset}`, file: await fittedBackground(file, imageBudget, /^image\/(webp|png|jpeg|gif)$/) })
      }
      setSaving("upload")
      const parts: DocumentPart[] = [
        ...(background ? [{ field: "background" as const, file: background }] : []),
        ...pieces,
        { field: "render", file: new File([render], render.type === "image/webp" ? "rendu.webp" : "rendu.png", { type: render.type }) },
        { field: "print", file: new File([print], "impression.jpg", { type: "image/jpeg" }) },
      ]
      let stored: CampaignDocumentRecord | null = null
      let backgroundSent = false
      const sent = new Set<string>()
      for (const form of await documentForms(documentJson, parts, requestLimit)) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/documents`, { method: "POST", body: form })
        const payload = (await response.json().catch(() => ({}))) as { document?: CampaignDocumentRecord; error?: string }
        if (!response.ok || !payload.document) {
          throw new Error(payload.error || (response.status === 413
            ? "Le document est trop lourd pour être envoyé à Eraser : allège l’image de fond, puis réessaie."
            : `Le document n’a pas pu être enregistré (réponse ${response.status} d’Eraser). Réessaie dans un instant.`))
        }
        const saved = payload.document
        stored = saved
        backgroundSent ||= form.has("background")
        for (const name of form.keys()) if (name.startsWith("piece-")) sent.add(name.slice(6))
        const clearUpload = backgroundSent
        const arrived = [...sent]
        // Chaque envoi réussi est gardé : si le suivant échoue, le document existe déjà (et ses images aussi).
        setDocuments((current) => current.some((document) => document.id === saved.id) ? current.map((document) => document.id === saved.id ? saved : document) : [...current, saved])
        setDraft((current) => current && current.id === saved.id ? {
          ...current, isNew: false, uploadFile: clearUpload && current.uploadFile === snapshot.uploadFile ? null : current.uploadFile,
          uploads: Object.fromEntries(Object.entries(current.uploads).filter(([asset, blob]) => !arrived.includes(asset) || blob !== uploads[asset])),
          remote: [...new Set([...current.remote, ...arrived])],
          renderVersion: saved.renderVersion, updatedAt: saved.updatedAt,
        } : current)
      }
      if (!stored) throw new Error("Le document n’a pas pu être enregistré.")
      if (stored.template) setTemplates((current) => [...current.filter((template) => template.id !== stored.id), stored].sort((left, right) => left.title.localeCompare(right.title, "fr")))
      const kept: Draft = {
        ...snapshot, isNew: false, uploadFile: null, uploads: {}, remote: [...new Set([...snapshot.remote, ...sent])],
        paint: Object.fromEntries(Object.entries(snapshot.paint).filter(([id]) => flattened[id] === undefined)),
        renderVersion: stored.renderVersion, updatedAt: stored.updatedAt,
      }
      setSavedSignature(signature(kept))
      try { window.localStorage.removeItem(backupKey(campaignId)) } catch { /* rien à effacer */ }
      setMessage({ tone: "ok", text: "Document enregistré : prêt à être donné aux joueurs et à partir dans Roll20." })
    } catch (error) {
      const text = error instanceof DOMException && error.name === "SecurityError"
        ? "Cette image de fond ne peut pas être dessinée (son site la protège). Envoie-la plutôt depuis ton ordinateur."
        : error instanceof Error ? error.message : "Le document n’a pas pu être enregistré."
      setMessage({ tone: "error", text })
    } finally {
      setSaving("")
    }
  }

  async function remove() {
    if (!draft) return
    if (draft.isNew) { releasePreviews(draft); setDraft(null); setSavedSignature(""); setDeleting(false); return }
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(draft.id)}`, { method: "DELETE" })
      if (!response.ok) throw new Error("DELETE_FAILED")
      setDocuments((current) => current.filter((document) => document.id !== draft.id))
      setTemplates((current) => current.filter((template) => template.id !== draft.id))
      releasePreviews(draft)
      setDraft(null)
      setSavedSignature("")
      resetEditing()
    } catch {
      setMessage({ tone: "error", text: "Le document n’a pas pu être supprimé." })
    } finally {
      setDeleting(false)
    }
  }

  /* ----- affichage ----- */

  const anyOverflow = selectedZone ? overflowing[selectedZone.id] : false
  const saved = draft && !draft.isNew ? documents.find((document) => document.id === draft.id) : undefined
  const zoneTools = tool === "select" && (selectedZone || !anySelected)
  const shapeKindOptions = shapeKinds.map((kind) => ({ value: kind.value, label: "", icon: shapeIcons[kind.value], title: kind.label }))
  const hints: Record<StageTool, string> = {
    select: "Clique sur un élément pour le choisir (sur un dessin : sur son encre) · trace un rectangle sur le fond pour créer une zone de texte · glisse le cadre pour déplacer, un coin pour redimensionner, la poignée ronde pour incliner (Maj : par 15°) · flèches : déplacer, Suppr : retirer, Ctrl+Z : annuler.",
    line: "Trace la ligne d’un bout à l’autre (Maj : par pas de 15°) : elle est ensuite choisie, à régler · L : en tracer une autre · Échap : revenir à la sélection.",
    shape: "Règle la prochaine forme dans la barre, puis trace-la d’un coin à l’autre (Maj : carré ou cercle) : elle est ensuite choisie, à régler · F : en tracer une autre · Échap : revenir à la sélection.",
    brush: "Dessine sur le document : le premier trait crée un calque de dessin, les suivants s’y ajoutent (choisis un autre calque pour y dessiner) · au stylet, la pression règle l’épaisseur · Échap : revenir à la sélection.",
    eraser: "Gomme dans le calque de dessin choisi (sinon le plus haut) · Échap : revenir à la sélection.",
  }

  return <div className="mt-7 grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
    {/* Les documents de la campagne */}
    <aside className="grid gap-2 xl:sticky xl:top-4">
      <Button type="button" onClick={() => guard(() => setChoosing(true))}><Plus />Nouveau document</Button>
      <DocumentLibrary
        campaignId={campaignId}
        documents={documents}
        currentId={draft?.id ?? null}
        emptyFolders={emptyFolders}
        sessionName={sessionName}
        organize={foldersOn}
        onOpen={open}
        onMove={moveToFolder}
        onCreateFolder={(name) => setEmptyFolders((current) => [...new Set([...current, name])])}
        onRenameFolder={(from, to) => void renameFolder(from, to)}
        onDeleteFolder={(name) => void deleteFolder(name)}
      />
    </aside>

    <section className="min-w-0 space-y-3">
      {backup && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-500/8 px-4 py-2.5 text-sm">
        <TriangleAlert className="size-4 text-amber-600" />
        <span className="min-w-0 flex-1">Un brouillon non enregistré de « {backup.title} » a été gardé{backup.savedAt ? ` (${new Date(backup.savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })})` : ""}.</span>
        <Button type="button" size="sm" onClick={() => guard(restoreBackup)}>Le reprendre</Button>
        <Button type="button" size="sm" variant="ghost" onClick={dropBackup}>L’oublier</Button>
      </div>}

      {!draft ? <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed bg-card/35 p-8 text-center">
        <div>
          <FileText className="mx-auto size-9 text-primary/40" />
          <p className="mt-3 font-display text-2xl font-semibold">{documents.length ? "Choisis un document" : "Aucun document"}</p>
          <p className="mt-1 text-sm text-muted-foreground">Une lettre, un parchemin, une page de grimoire : écris-le sur un fond, puis donne-le à un joueur ou envoie-le dans Roll20.</p>
          <Button type="button" className="mt-5" onClick={() => setChoosing(true)}><Plus />Écrire un document</Button>
        </div>
      </div> : <>
        {/* Le document : titre, session, dossier, fond, enregistrement */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/70 p-2.5">
          <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value.slice(0, 160) })} aria-label="Titre du document" placeholder="Titre du document" className="h-10 min-w-48 flex-1 border-transparent bg-transparent font-display text-xl font-semibold shadow-none focus-visible:border-input md:text-xl" />
          <NativeSelect value={draft.sessionId} onChange={(event) => setDraft({ ...draft, sessionId: event.target.value })} aria-label="Session du document" title="La session où ce document servira (Créateur de session, Roll20)">
            <NativeSelectOption value="">Aucune session</NativeSelectOption>
            {[...sessions].reverse().map((session) => <NativeSelectOption key={session.id} value={session.id}>{session.name}</NativeSelectOption>)}
          </NativeSelect>
          {foldersOn && <span className="flex items-center gap-1" title="Le dossier où ranger ce document">
            <Folder className="size-4 text-muted-foreground" />
            <NativeSelect value={draft.folder} onChange={(event) => chooseFolder(event.target.value)} aria-label="Dossier du document">
              <NativeSelectOption value="">Sans dossier</NativeSelectOption>
              {[...new Set([...folders, ...(draft.folder ? [draft.folder] : [])])].map((folder) => <NativeSelectOption key={folder} value={folder}>{folder}</NativeSelectOption>)}
              <NativeSelectOption value={NEW_FOLDER}>Nouveau dossier…</NativeSelectOption>
            </NativeSelect>
          </span>}
          <span className="flex items-center gap-0.5">
            <ToolButton label="Annuler (Ctrl+Z)" disabled={!history.past.length} onClick={undo}><Undo2 className="size-4" /></ToolButton>
            <ToolButton label="Refaire (Ctrl+Y)" disabled={!history.future.length} onClick={redo}><Redo2 className="size-4" /></ToolButton>
            <ToolButton label={showFrames ? "Cacher les cadres des zones" : "Montrer les cadres des zones"} active={showFrames} onClick={() => setShowFrames((current) => !current)}><Frame className="size-4" /></ToolButton>
          </span>
          <Popover open={changingBackground} onOpenChange={setChangingBackground}>
            <PopoverTrigger asChild><Button type="button" variant="outline"><FileImage />Fond</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)]">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Changer le fond</p>
              <BackgroundChoices compact onBuiltin={(key) => changeBackground({ kind: "builtin", key })} onFile={(file) => changeBackground({ kind: "upload" }, file)} onUrl={(url) => changeBackground({ kind: "url", url })} />
              <p className={cn(hintText, "mt-2")}>Le texte, les lignes, les images et les dessins restent à leur place.</p>
            </PopoverContent>
          </Popover>
          <Button type="button" onClick={() => void save()} disabled={Boolean(saving) || (!dirty && Boolean(draft.renderVersion))} title="Ctrl+S">
            {saving ? <LoaderCircle className="animate-spin" /> : dirty || !draft.renderVersion ? <Save /> : <Check />}
            {saving === "render" ? "Dessin du document…" : saving === "upload" ? "Enregistrement…" : dirty || !draft.renderVersion ? "Enregistrer" : "Enregistré"}
          </Button>
        </div>

        {/* Les outils, et les réglages de l'élément choisi */}
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-2xl border bg-background/95 p-1.5 shadow-sm backdrop-blur">
          {layersOn && <>
            <Segmented<StageTool> ariaLabel="Outil" value={tool} onChange={chooseTool} options={[
              { value: "select", label: "", icon: <MousePointer2 className="size-3.5" />, title: "Sélection (V)" },
              { value: "line", label: "", icon: <Slash className="size-3.5" />, title: "Ligne droite (L)" },
              ...(shapesOn ? [{ value: "shape" as const, label: "", icon: <Shapes className="size-3.5" />, title: "Forme (F) : rectangle, ellipse, triangle, losange, étoile" }] : []),
              { value: "brush", label: "", icon: <PenTool className="size-3.5" />, title: "Plume (P) : dessin à main levée" },
              { value: "eraser", label: "", icon: <Eraser className="size-3.5" />, title: "Gomme (E) : dans un calque de dessin" },
            ]} />
            <Separator />
          </>}
          <Button type="button" size="sm" variant="secondary" onMouseDown={(event) => event.preventDefault()} onClick={() => addZone()} title="Ajouter une zone de texte (ou trace un rectangle sur le document)"><Plus />Zone</Button>
          {layersOn && <>
            <Button type="button" size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => imageInput.current?.click()} title="Poser une image de l’ordinateur sur le document"><ImagePlus />Image</Button>
            <input ref={imageInput} type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addImage(file) }} />
            <LayersPopover content={draft.content} selectedId={selectedId} onSelect={(id) => { setTool("select"); setSelectedId(id) }} onMove={moveLayer} />
          </>}
          <Separator />

          {/* La plume */}
          {tool === "brush" && <>
            <InkPicker value={tools.brush.color} onPick={(color) => setBrush({ color })} title="Couleur de la plume" />
            <NumberStepper label="Épaisseur de la plume" value={tools.brush.size} min={0.5} max={80} step={1} onChange={(size) => setBrush({ size })} />
            <Popover>
              <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" title="La pointe de la plume : calligraphie, angle, opacité"><PenTool />Pointe</Button></PopoverTrigger>
              <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
                <div className="flex items-center gap-3"><NibPreview brush={tools.brush} /><p className={hintText}>Une pointe plate trace des pleins et des déliés selon la direction du trait, comme une plume taillée.</p></div>
                <Range text="Calligraphie" value={Math.round(tools.brush.nib * 100)} min={0} max={100} step={1} format={(value) => value ? `${value} %` : "Ronde"} onChange={(value) => setBrush({ nib: value / 100 })} />
                <Range text="Angle de la pointe" value={tools.brush.angle} min={0} max={180} step={1} format={(value) => `${value}°`} onChange={(angle) => setBrush({ angle })} />
                <Range text="Opacité de l’encre" value={Math.round(tools.brush.opacity * 100)} min={5} max={100} step={1} format={(value) => `${value} %`} onChange={(value) => setBrush({ opacity: value / 100 })} />
              </PopoverContent>
            </Popover>
          </>}
          {tool === "eraser" && <NumberStepper label="Taille de la gomme" value={tools.brush.eraserSize} min={2} max={200} step={4} onChange={(eraserSize) => setBrush({ eraserSize })} />}

          {/* Une ligne : celle qui est choisie, ou les prochaines */}
          {lineControls && (tool === "line" || tool === "select") && <>
            <NumberStepper label="Épaisseur du trait" value={lineControls.width} min={0.5} max={80} step={1} onChange={(width) => setLine({ width }, "width")} />
            <Segmented<DocumentLineStyle> ariaLabel="Trait" value={lineControls.style} onChange={(style) => setLine({ style }, "style")} options={[
              { value: "solid", label: "Plein", title: "Trait plein" },
              { value: "dashed", label: "Tirets", title: "Trait en tirets" },
              { value: "dotted", label: "Points", title: "Trait en pointillés" },
            ]} />
            <InkPicker value={lineControls.color} onPick={(color) => setLine({ color }, "color")} title="Couleur de la ligne" />
            <Popover>
              <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" title="Opacité et fusion de la ligne"><RotateCcw />Réglages</Button></PopoverTrigger>
              <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
                <Range text="Opacité" value={Math.round(lineControls.opacity * 100)} min={5} max={100} step={1} format={(value) => `${value} %`} onChange={(value) => setLine({ opacity: value / 100 }, "opacity")} />
                <BlendSelect value={lineControls.blend} onChange={(blend) => setLine({ blend }, "blend")} />
              </PopoverContent>
            </Popover>
          </>}

          {/* Une forme : celle qui est choisie, ou les prochaines */}
          {shapeControls && (tool === "shape" || tool === "select") && <>
            {/* Avec l'outil Forme : la prochaine forme ; avec la sélection : la forme choisie. */}
            <Segmented<DocumentShapeKind> ariaLabel="Forme" value={tool === "shape" ? tools.shape.shape : shapeControls.shape} onChange={(shape) => tool === "shape" ? setTools((current) => ({ ...current, shape: { ...current.shape, shape } })) : setShape({ shape }, "shape")} options={shapeKindOptions} />
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" onMouseDown={(event) => event.preventDefault()} title="Le remplissage : aucun, uni ou en dégradé" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-muted">
                  <span className="size-4 rounded-sm border shadow-inner" style={{ background: fillPreview(shapeControls) }} /><span className="text-xs">Remplissage</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
                <Segmented<DocumentShapeFill> ariaLabel="Remplissage" value={shapeControls.fill} onChange={(fill) => setShape({ fill }, "fill")} options={[
                  { value: "none", label: "Aucun", title: "Sans remplissage" },
                  { value: "solid", label: "Uni", title: "Une seule couleur" },
                  { value: "linear", label: "Dégradé", title: "Dégradé d’un bord à l’autre" },
                  { value: "radial", label: "Radial", title: "Dégradé du centre vers les bords" },
                ]} />
                {shapeControls.fill !== "none" && <div className="flex flex-wrap items-center gap-1">
                  <InkPicker value={shapeControls.fillColor} onPick={(fillColor) => setShape({ fillColor }, "fillColor")} title={shapeControls.fill === "solid" ? "Couleur du remplissage" : "Couleur de départ du dégradé"} label={shapeControls.fill === "solid" ? "Couleur" : shapeControls.fill === "radial" ? "Centre" : "Départ"} />
                  {shapeControls.fill !== "solid" && <InkPicker value={shapeControls.fillColor2} onPick={(fillColor2) => setShape({ fillColor2 }, "fillColor2")} title="Couleur d’arrivée du dégradé" label={shapeControls.fill === "radial" ? "Bords" : "Arrivée"} />}
                </div>}
                {(shapeControls.fill === "linear" || shapeControls.fill === "radial") && <Range text="Opacité de l’arrivée" value={Math.round(shapeControls.fillOpacity2 * 100)} min={0} max={100} step={1} format={(value) => value ? `${value} %` : "Transparente"} onChange={(value) => setShape({ fillOpacity2: value / 100 }, "fillOpacity2")} />}
                {shapeControls.fill === "linear" && <Range text="Sens du dégradé" value={shapeControls.gradientAngle} min={0} max={360} step={5} format={(value) => `${value}°`} onChange={(gradientAngle) => setShape({ gradientAngle }, "gradientAngle")} />}
              </PopoverContent>
            </Popover>
            <InkPicker value={shapeControls.strokeColor} onPick={(strokeColor) => setShape({ strokeColor }, "strokeColor")} title="Couleur du contour" label="Contour" />
            <NumberStepper label="Épaisseur du contour (0 : aucun)" value={shapeControls.strokeWidth} min={0} max={80} step={1} onChange={(strokeWidth) => setShape({ strokeWidth }, "strokeWidth")} />
            <Popover>
              <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" title="Trait du contour, inclinaison, arrondi, opacité, fusion"><RotateCcw />{selectedShape ? `${Math.round(selectedShape.rotation)}°` : "Réglages"}</Button></PopoverTrigger>
              <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
                <Segmented<DocumentLineStyle> ariaLabel="Trait du contour" value={shapeControls.strokeStyle} onChange={(strokeStyle) => setShape({ strokeStyle }, "strokeStyle")} options={[
                  { value: "solid", label: "Plein", title: "Contour plein" },
                  { value: "dashed", label: "Tirets", title: "Contour en tirets" },
                  { value: "dotted", label: "Points", title: "Contour en pointillés" },
                ]} />
                {selectedShape && <Range text="Inclinaison" value={selectedShape.rotation} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(rotation) => patchBox({ rotation }, "rotation")} />}
                {shapeControls.shape === "rectangle" && <Range text="Arrondi des coins" value={shapeControls.radius} min={0} max={200} step={1} format={(value) => value ? String(value) : "Aucun"} onChange={(radius) => setShape({ radius }, "radius")} />}
                <Range text="Opacité" value={Math.round(shapeControls.opacity * 100)} min={5} max={100} step={1} format={(value) => `${value} %`} onChange={(value) => setShape({ opacity: value / 100 }, "opacity")} />
                <BlendSelect value={shapeControls.blend} onChange={(blend) => setShape({ blend }, "blend")} />
              </PopoverContent>
            </Popover>
          </>}

          {/* Une image ou un calque de dessin choisi */}
          {tool === "select" && selectedPicture && <>
            <span className="px-1 text-xs font-medium text-muted-foreground">{selectedPicture.kind === "drawing" ? "Calque de dessin" : "Image"}</span>
            <Popover>
              <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" title="Inclinaison, opacité, fusion"><RotateCcw />{`${Math.round(selectedPicture.rotation)}°`}</Button></PopoverTrigger>
              <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
                <Range text="Inclinaison" value={selectedPicture.rotation} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(rotation) => patchPicture({ rotation }, "rotation")} />
                <Range text="Opacité" value={Math.round(selectedPicture.opacity * 100)} min={5} max={100} step={1} format={(value) => `${value} %`} onChange={(value) => patchPicture({ opacity: value / 100 }, "opacity")} />
                <BlendSelect value={selectedPicture.blend} onChange={(blend) => patchPicture({ blend }, "blend")} />
                {selectedPicture.kind === "drawing" && <Button type="button" size="sm" variant="outline" onClick={() => chooseTool("brush")}><PenTool />Dessiner dans ce calque</Button>}
              </PopoverContent>
            </Popover>
          </>}

          {/* Une zone de texte (ou rien de choisi : la barre du texte, inactive) */}
          {zoneTools && <>
            <FontPicker value={selectedZone?.font ?? "fell"} disabled={!selectedZone} onChange={(font) => patchZone({ font }, "font")} />
            <NumberStepper label="Taille du texte" value={selectedZone?.size ?? 30} min={6} max={400} step={2} disabled={!selectedZone} onChange={(size) => patchZone({ size }, "size")} />
            <Separator />
            <ToolButton label="Gras (Ctrl+B)" active={Boolean(editingId) && formats.bold} disabled={!selectedZone} onClick={() => format("bold")}><Bold className="size-4" /></ToolButton>
            <ToolButton label="Italique (Ctrl+I)" active={Boolean(editingId) && formats.italic} disabled={!selectedZone} onClick={() => format("italic")}><Italic className="size-4" /></ToolButton>
            <ToolButton label="Souligné (Ctrl+U)" active={Boolean(editingId) && formats.underline} disabled={!selectedZone} onClick={() => format("underline")}><Underline className="size-4" /></ToolButton>
            <ToolButton label="Barré" active={Boolean(editingId) && formats.strike} disabled={!selectedZone} onClick={() => format("strikeThrough")}><Strikethrough className="size-4" /></ToolButton>
            <InkPicker value={selectedZone?.color ?? DEFAULT_INK} disabled={!selectedZone} onPick={(color) => format("foreColor", color)} title="Couleur de l’encre (du texte choisi, sinon de toute la zone)" hint="Sur le texte choisi, ou toute la zone si rien n’est choisi." />
            <Separator />
            <Segmented<DocumentAlign> ariaLabel="Alignement" disabled={!selectedZone} value={selectedZone?.align ?? "left"} onChange={(align) => patchZone({ align }, "align")} options={[
              { value: "left", label: "", icon: <AlignLeft className="size-3.5" />, title: "À gauche" },
              { value: "center", label: "", icon: <AlignCenter className="size-3.5" />, title: "Centré" },
              { value: "right", label: "", icon: <AlignRight className="size-3.5" />, title: "À droite" },
              { value: "justify", label: "", icon: <AlignJustify className="size-3.5" />, title: "Justifié" },
            ]} />
            <Segmented<DocumentVerticalAlign> ariaLabel="Position verticale" disabled={!selectedZone} value={selectedZone?.valign ?? "top"} onChange={(valign) => patchZone({ valign }, "valign")} options={[
              { value: "top", label: "", icon: <AlignVerticalJustifyStart className="size-3.5" />, title: "En haut de la zone" },
              { value: "middle", label: "", icon: <AlignVerticalJustifyCenter className="size-3.5" />, title: "Au milieu de la zone" },
              { value: "bottom", label: "", icon: <AlignVerticalJustifyEnd className="size-3.5" />, title: "En bas de la zone" },
            ]} />
            <Separator />
            <Popover>
              <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" disabled={!selectedZone} onMouseDown={(event) => event.preventDefault()} title="Inclinaison, interligne, espacement, opacité, fusion"><RotateCcw />{selectedZone ? `${Math.round(selectedZone.rotation)}°` : "Réglages"}</Button></PopoverTrigger>
              <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
                {selectedZone && <>
                  <Range text="Inclinaison" value={selectedZone.rotation} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(rotation) => patchZone({ rotation }, "rotation")} />
                  <div className="flex flex-wrap gap-1">{[-15, -5, 0, 5, 15, 90].map((angle) => <Button key={angle} type="button" size="xs" variant={Math.round(selectedZone.rotation) === angle ? "secondary" : "ghost"} onClick={() => patchZone({ rotation: angle }, "rotation-preset")}>{angle > 0 ? `+${angle}` : angle}°</Button>)}</div>
                  <Range text="Interligne" value={selectedZone.lineHeight} min={0.8} max={2.6} step={0.05} format={(value) => value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} onChange={(lineHeight) => patchZone({ lineHeight }, "lineHeight")} />
                  <Range text="Espacement des lettres" value={selectedZone.letterSpacing} min={-3} max={30} step={0.5} format={(value) => value.toLocaleString("fr-FR")} onChange={(letterSpacing) => patchZone({ letterSpacing }, "letterSpacing")} />
                  <Range text="Opacité de l’encre" value={Math.round(selectedZone.opacity * 100)} min={10} max={100} step={1} format={(value) => `${value} %`} onChange={(opacity) => patchZone({ opacity: opacity / 100 }, "opacity")} />
                  {layersOn
                    ? <BlendSelect value={zoneBlend(selectedZone)} onChange={(blend) => patchZone({ blend, ink: blend === "multiply" }, "blend")} />
                    : <Toggle checked={selectedZone.ink} onChange={(ink) => patchZone({ ink }, "ink")} title="L’encre se mêle au grain du papier au lieu de le recouvrir">Encre mêlée au papier</Toggle>}
                </>}
              </PopoverContent>
            </Popover>
          </>}

          {/* Ce qu'on fait de l'élément choisi */}
          {(tool === "select" || selectedLine) && <>
            <ToolButton label="Mettre au premier plan" disabled={!anySelected} onClick={() => selectedId && moveLayer(selectedId, "top")}><ArrowUpToLine className="size-4" /></ToolButton>
            <ToolButton label="Mettre à l’arrière-plan" disabled={!anySelected} onClick={() => selectedId && moveLayer(selectedId, "bottom")}><ArrowDownToLine className="size-4" /></ToolButton>
            <ToolButton label="Dupliquer (Ctrl+D)" disabled={!anySelected} onClick={duplicateElement}><Copy className="size-4" /></ToolButton>
            <ToolButton label="Supprimer (Suppr)" disabled={!anySelected} onClick={deleteElement}><Trash2 className="size-4 text-destructive/80" /></ToolButton>
          </>}
        </div>

        {!layersOn && <p className={cn(hintText, "px-1")}>Lignes, formes, images, dessin et modes de fusion arrivent avec la prochaine version d’Eraser : « Chercher les mises à jour » dans la barre latérale.</p>}
        {message && <p className={cn("rounded-xl border px-4 py-2.5 text-sm", message.tone === "ok" ? "border-emerald-600/25 bg-emerald-600/8 text-emerald-800 dark:text-emerald-300" : "border-destructive/25 bg-destructive/5 text-destructive")}>{message.text}</p>}
        {anyOverflow && <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400"><TriangleAlert className="size-3.5" />Le texte dépasse de sa zone : agrandis-la ou réduis la taille du texte.</p>}

        {/* Le document */}
        <div className="rounded-2xl border bg-[repeating-conic-gradient(rgb(0_0_0/0.035)_0_25%,transparent_0_50%)] bg-[length:22px_22px] p-3 sm:p-5">
          <div className="mx-auto w-full max-w-[min(100%,calc(78vh*var(--document-ratio)))]" style={{ ["--document-ratio" as string]: String(DOCUMENT_WIDTH / draft.content.height) }}>
            <DocumentStage
              content={draft.content}
              backgroundSrc={backgroundSrc}
              selectedId={selectedId}
              contentKeys={contentKeys}
              showFrames={showFrames}
              scale={scale}
              tool={tool}
              brush={tools.brush}
              lineSettings={tools.line}
              paint={draft.paint}
              pictureSrc={pictureSrc}
              onScale={setScale}
              onSelect={setSelectedId}
              onZoneChange={changeZone}
              onPictureChange={changePicture}
              onShapeChange={changeShape}
              onCreateShape={addShape}
              shapeSettings={tools.shape}
              onLineChange={changeLine}
              onZoneText={zoneText}
              onCreateZone={(rect) => addZone(rect)}
              onCreateLine={addLine}
              onStroke={stroke}
              onEditing={editing}
              onOverflow={overflow}
              onBackgroundSize={backgroundSize}
            />
          </div>
        </div>
        <p className={cn(hintText, "text-center")}>{hints[tool]}</p>

        {/* Ce qu'on fait du document */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/60 p-2.5">
          <span className={cn(fieldLabel, "mr-auto")}>{draft.isNew ? "Pas encore enregistré" : saved?.updatedAt ? `Enregistré le ${new Date(saved.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}{dirty && !draft.isNew ? " · modifications non enregistrées" : ""}</span>
          <Button type="button" variant="outline" size="sm" disabled={!draft.renderVersion} title={draft.renderVersion ? "Voir le document comme le joueur le lira" : "Enregistre d’abord le document"} onClick={() => setViewing({ campaignId, documentId: draft.id, title: draft.title, version: draft.renderVersion })}><Eye />Aperçu</Button>
          <GiveDocumentButton campaignId={campaignId} documentId={draft.id} title={draft.title} players={players} disabledReason={!draft.renderVersion ? "Enregistre d’abord le document" : dirty ? "Enregistre d’abord tes modifications" : ""} onGiven={(text) => setMessage({ tone: "ok", text })} />
          <Button type="button" variant="outline" size="sm" disabled={draft.isNew || dirty || copying} title={draft.isNew ? "Enregistre d’abord le document" : dirty ? "Enregistre d’abord tes modifications" : "Une copie de ce document, à modifier"} onClick={duplicateDocument}>{copying ? <LoaderCircle className="animate-spin" /> : <CopyPlus />}Dupliquer</Button>
          {templatesOn && <Button type="button" variant={draft.template ? "secondary" : "ghost"} size="sm" aria-pressed={draft.template} title={draft.template ? "C’est un modèle : il est proposé dans « Nouveau document », dans toutes tes campagnes. Clique pour le retirer des modèles." : "En faire un modèle : il sera proposé dans « Nouveau document », dans toutes tes campagnes"} onClick={() => void place(draft, { template: !draft.template })}><LayoutTemplate />{draft.template ? "Modèle" : "En faire un modèle"}</Button>}
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 />Supprimer</Button>
        </div>
      </>}
    </section>

    <Dialog open={choosing} onOpenChange={setChoosing}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ImagePlus className="size-5 text-primary" />Un nouveau document</DialogTitle>
          <DialogDescription>Pars d’un de tes modèles, ou choisis un fond. Les fonds d’Eraser arrivent avec des zones de texte prêtes à remplir.</DialogDescription>
        </DialogHeader>
        {templatesOn && templates.length > 0 && <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground"><LayoutTemplate className="size-3.5" />Tes modèles</p>
          <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {templates.map((template) => <button key={template.id} type="button" disabled={copying} onClick={() => fromTemplate(template)} className="group grid gap-1 rounded-xl border bg-card/60 p-1.5 text-center transition hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50">
              <span className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-muted/40">
                {template.renderVersion
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={documentImageUrl(template.campaignId, template.id, template.renderVersion)} alt="" loading="lazy" className="size-full object-contain transition group-hover:scale-[1.03]" />
                  : <LayoutTemplate className="size-6 text-primary/40" />}
              </span>
              <span className="truncate text-xs font-medium">{template.title}</span>
            </button>)}
          </div>
          {copying && <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-busy="true"><LoaderCircle className="size-3.5 animate-spin" />Copie du modèle…</p>}
          <p className="mt-1 text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Ou un fond</p>
        </div>}
        <BackgroundChoices onBuiltin={(key) => create({ kind: "builtin", key })} onFile={(file) => create({ kind: "upload" }, file)} onUrl={(url) => create({ kind: "url", url })} />
      </DialogContent>
    </Dialog>

    <Dialog open={newFolderFor !== null} onOpenChange={(next) => { if (!next) setNewFolderFor(null) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Folder className="size-5 text-primary" />Nouveau dossier</DialogTitle>
          <DialogDescription>Le document y sera rangé.</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault()
          const name = (newFolderFor ?? "").replace(/\s+/g, " ").trim().slice(0, 80)
          setNewFolderFor(null)
          if (name && draft) { setEmptyFolders((current) => [...new Set([...current, name])]); void place(draft, { folder: name }) }
        }}>
          <Input autoFocus value={newFolderFor ?? ""} onChange={(event) => setNewFolderFor(event.target.value)} placeholder="Nom du dossier" aria-label="Nom du dossier" className="min-w-0 flex-1" />
          <Button type="submit" disabled={!newFolderFor?.trim()}>Créer</Button>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(pendingSwitch)} onOpenChange={(next) => { if (!next) setPendingSwitch(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Abandonner les modifications ?</AlertDialogTitle><AlertDialogDescription>« {draft?.title} » a des modifications non enregistrées.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Rester</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { const action = pendingSwitch; setPendingSwitch(null); try { window.localStorage.removeItem(backupKey(campaignId)) } catch { /* rien */ } action?.() }}>Abandonner</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={deleting} onOpenChange={setDeleting}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Supprimer « {draft?.title} » ?</AlertDialogTitle><AlertDialogDescription>Le document disparaît de la campagne. Les exemplaires déjà donnés aux joueurs restent lisibles dans leur inventaire.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove()}><Trash2 />Supprimer</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <DocumentViewerDialog document={viewing} onClose={() => setViewing(null)} />
  </div>
}

/** Le fond envoyé depuis l'ordinateur et déjà enregistré (versionné par la date du document). */
function documentBackgroundUrl(campaignId: string, draft: Pick<Draft, "id" | "updatedAt" | "isNew">) {
  if (draft.isNew) return ""
  return `/api/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(draft.id)}/image?part=fond&v=${encodeURIComponent(draft.updatedAt.replace(/[^0-9A-Za-z]/g, ""))}`
}
