import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  ArrowDownToLine, ArrowUpToLine, Bold, Check, Copy, Eye, FileImage, FileText, Frame, ImagePlus, Italic, Link2, LoaderCircle,
  Minus, Plus, Redo2, RotateCcw, Save, ScrollText, Strikethrough, Trash2, TriangleAlert, Type, Underline, Undo2, Upload,
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
  DOCUMENT_RENDER_WIDTH, DOCUMENT_WIDTH, builtinBackgroundKeys, cleanDocumentContent, documentFontKeys,
  documentImageUrl, documentStudioHref,
  type BuiltinBackgroundKey, type CampaignDocumentRecord, type DocumentAlign, type DocumentBackground, type DocumentContent,
  type DocumentParagraph, type DocumentVerticalAlign, type DocumentZone,
} from "@/lib/document-model"
import { cn } from "@/lib/utils"

import { builtinBackgrounds, documentFonts, documentFromBuiltin, newDocumentZone } from "./document-assets"
import { backgroundSource, canvasBlob, loadDocumentFonts, loadImage, renderDocumentCanvas } from "./document-render"
import { DocumentStage, focusAt, zoneEditable } from "./document-stage"
import { paragraphsFromElement } from "./document-text"

/**
 * L'éditeur des documents (l'ancienne page Document d'Eraser) : les documents de la campagne
 * (parchemins, lettres, livres…) et leur éditeur. On choisit un fond (fourni, depuis l'ordinateur ou une adresse), on pose des zones
 * de texte où l'on veut, droites ou inclinées, chacune avec sa police et sa mise en forme.
 * « Enregistrer » dessine le document : c'est cette image que reçoivent les joueurs (« Donner
 * à… ») et Roll20 (handout et PDF, par le compagnon).
 */

type Draft = {
  id: string
  isNew: boolean
  title: string
  sessionId: string
  background: DocumentBackground
  content: DocumentContent
  /** Le fond choisi sur l'ordinateur, pas encore envoyé, et son aperçu. */
  uploadFile: File | null
  uploadPreview: string
  renderVersion: string
  updatedAt: string
}

type Player = { id: string; name: string }
type Message = { tone: "ok" | "error"; text: string } | null

const INKS = [
  { color: "#2b1d12", label: "Encre noire" },
  { color: "#5b3a1e", label: "Sépia" },
  { color: "#8b1a1a", label: "Rouge sang" },
  { color: "#1f3a5f", label: "Bleu nuit" },
  { color: "#2f4f2f", label: "Vert sombre" },
  { color: "#4b2a5e", label: "Violet" },
  { color: "#9a7417", label: "Or" },
  { color: "#f4ead6", label: "Craie" },
]

const signature = (draft: Draft | null) => draft ? JSON.stringify({ title: draft.title, sessionId: draft.sessionId, background: draft.background, content: draft.content, upload: draft.uploadFile ? `${draft.uploadFile.name}:${draft.uploadFile.size}` : "" }) : ""

function draftOf(document: CampaignDocumentRecord): Draft {
  return { id: document.id, isNew: false, title: document.title, sessionId: document.sessionId, background: document.background, content: document.content, uploadFile: null, uploadPreview: "", renderVersion: document.renderVersion, updatedAt: document.updatedAt }
}

const backupKey = (campaignId: string) => `eraser-document-draft:${campaignId}`

function readBackup(campaignId: string): (Draft & { savedAt: string }) | null {
  try {
    const raw = window.localStorage.getItem(backupKey(campaignId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Draft & { savedAt: string }
    if (!parsed?.id || parsed.background?.kind === "upload" && parsed.isNew) return null
    return { ...parsed, content: cleanDocumentContent(parsed.content), uploadFile: null, uploadPreview: "" }
  } catch { return null }
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

export function DocumentStudio({ campaignId, initialDocuments, sessions, players, initialDocumentId = "", initialSessionId = "", startNew = false }: {
  campaignId: string
  initialDocuments: CampaignDocumentRecord[]
  sessions: Array<{ id: string; name: string }>
  players: Player[]
  initialDocumentId?: string
  initialSessionId?: string
  startNew?: boolean
}) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [draft, setDraft] = useState<Draft | null>(() => {
    const found = initialDocuments.find((document) => document.id === initialDocumentId) ?? (startNew ? null : initialDocuments.at(-1))
    return found ? draftOf(found) : null
  })
  const [savedSignature, setSavedSignature] = useState(() => signature(draft))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [contentKeys, setContentKeys] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<{ past: DocumentZone[][]; future: DocumentZone[][] }>({ past: [], future: [] })
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
  const lastHistory = useRef({ key: "", at: 0 })
  const focusSnapshot = useRef<{ id: string; zones: DocumentZone[]; text: string } | null>(null)

  const dirty = Boolean(draft) && signature(draft) !== savedSignature
  const zones = useMemo(() => draft?.content.zones ?? [], [draft])
  const selected = zones.find((zone) => zone.id === selectedId) ?? null
  const sessionName = (id: string) => sessions.find((session) => session.id === id)?.name ?? ""

  useEffect(() => { void loadDocumentFonts() }, [])

  // Un brouillon non enregistré (application fermée, page quittée) : proposé à la réouverture.
  useEffect(() => {
    const found = readBackup(campaignId)
    if (found) queueMicrotask(() => setBackup(found))
  }, [campaignId])
  useEffect(() => {
    if (!draft || !dirty) return
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(backupKey(campaignId), JSON.stringify({ ...draft, uploadFile: null, uploadPreview: "", savedAt: new Date().toISOString() }))
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

  const remember = useCallback((zonesBefore: DocumentZone[], key = "") => {
    const now = Date.now()
    // Plusieurs pas d'un même réglage (un curseur qu'on fait glisser) : un seul retour en arrière.
    if (key && lastHistory.current.key === key && now - lastHistory.current.at < 900) { lastHistory.current.at = now; return }
    lastHistory.current = { key, at: now }
    setHistory((current) => ({ past: [...current.past.slice(-59), zonesBefore], future: [] }))
  }, [])

  const changeZone = useCallback((id: string, next: (zone: DocumentZone) => DocumentZone, history: boolean | string) => {
    if (history && draft) remember(draft.content.zones, typeof history === "string" ? `${history}:${id}` : "")
    setDraft((current) => current && { ...current, content: { ...current.content, zones: current.content.zones.map((zone) => zone.id === id ? next(zone) : zone) } })
  }, [draft, remember])

  const setZones = useCallback((next: DocumentZone[], history = true) => {
    if (history && draft) remember(draft.content.zones)
    setDraft((current) => current && { ...current, content: { ...current.content, zones: next } })
  }, [draft, remember])

  /** Des zones remplacées d'ailleurs (annuler, refaire) : leur texte est reposé dans la page. */
  function applyZones(next: DocumentZone[]) {
    if (!draft) return
    const before = new Map(draft.content.zones.map((zone) => [zone.id, JSON.stringify(zone.paragraphs)]))
    setContentKeys((keys) => {
      const updated = { ...keys }
      for (const zone of next) if (before.get(zone.id) !== JSON.stringify(zone.paragraphs)) updated[zone.id] = (updated[zone.id] ?? 0) + 1
      return updated
    })
    setDraft((current) => current && { ...current, content: { ...current.content, zones: next } })
    if (selectedId && !next.some((zone) => zone.id === selectedId)) setSelectedId(null)
  }

  function undo() {
    if (!draft || !history.past.length) return
    const previous = history.past[history.past.length - 1]
    setHistory({ past: history.past.slice(0, -1), future: [draft.content.zones, ...history.future].slice(0, 60) })
    lastHistory.current = { key: "", at: 0 }
    applyZones(previous)
  }
  function redo() {
    if (!draft || !history.future.length) return
    const [next, ...rest] = history.future
    setHistory({ past: [...history.past, draft.content.zones].slice(-60), future: rest })
    lastHistory.current = { key: "", at: 0 }
    applyZones(next)
  }

  const zoneText = useCallback((id: string, paragraphs: DocumentParagraph[]) => {
    setDraft((current) => current && { ...current, content: { ...current.content, zones: current.content.zones.map((zone) => zone.id === id ? { ...zone, paragraphs } : zone) } })
  }, [])

  const editing = useCallback((id: string | null) => {
    if (id && draft) {
      const zone = draft.content.zones.find((candidate) => candidate.id === id)
      focusSnapshot.current = { id, zones: draft.content.zones, text: JSON.stringify(zone?.paragraphs ?? []) }
    } else if (!id && focusSnapshot.current && draft) {
      // Le texte écrit d'une traite compte pour un seul retour en arrière.
      const snapshot = focusSnapshot.current
      const zone = draft.content.zones.find((candidate) => candidate.id === snapshot.id)
      if (zone && JSON.stringify(zone.paragraphs) !== snapshot.text) {
        lastHistory.current = { key: "", at: 0 }
        setHistory((current) => ({ past: [...current.past.slice(-59), snapshot.zones], future: [] }))
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

  /* ----- zones ----- */

  function addZone(rect?: { x: number; y: number; width: number; height: number }) {
    if (!draft) return
    // La nouvelle zone reprend le style de la zone choisie (police, taille, encre).
    const model = selected ?? zones.at(-1)
    const zone = newDocumentZone({
      ...(model ? { font: model.font, size: model.size, color: model.color, lineHeight: model.lineHeight, opacity: model.opacity, ink: model.ink, align: model.align } : {}),
      ...(rect ?? { x: DOCUMENT_WIDTH / 2 - 250, y: draft.content.height / 2 - 70, width: 500, height: 140 }),
      paragraphs: rect ? [] : [[{ text: "Nouveau texte" }]],
    })
    setZones([...zones, zone])
    setSelectedId(zone.id)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = zoneEditable(zone.id)
      if (!element) return
      focusAt(element, null)
      if (!rect) document.execCommand("selectAll")
    }))
  }

  function duplicateZone() {
    if (!selected) return
    const copy = { ...selected, id: crypto.randomUUID(), x: selected.x + 24, y: selected.y + 24 }
    setZones([...zones, copy])
    setSelectedId(copy.id)
  }

  function deleteZone() {
    if (!selected) return
    setZones(zones.filter((zone) => zone.id !== selected.id))
    setSelectedId(null)
  }

  function reorder(direction: "front" | "back") {
    if (!selected) return
    const others = zones.filter((zone) => zone.id !== selected.id)
    setZones(direction === "front" ? [...others, selected] : [selected, ...others])
  }

  const patchSelected = (patch: Partial<DocumentZone>, key: string) => { if (selected) changeZone(selected.id, (zone) => ({ ...zone, ...patch }), key) }

  /**
   * Gras, italique, souligné, barré, couleur : sur le texte choisi, ou sur toute la zone quand
   * rien n'est choisi dedans.
   */
  function format(command: "bold" | "italic" | "underline" | "strikeThrough" | "foreColor", value?: string) {
    if (!selected) return
    const element = zoneEditable(selected.id)
    if (!element) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const inside = Boolean(range && !range.collapsed && element.contains(range.commonAncestorContainer))
    if (!inside && command === "foreColor" && value) {
      // Rien de choisi : la couleur de l'encre de toute la zone (le texte coloré à part le reste).
      patchSelected({ color: value }, "color")
      return
    }
    const before = draft?.content.zones ?? []
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
    zoneText(selected.id, paragraphsFromElement(element))
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
      if (typing) return
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return }
      if (!selected) return
      if (mod && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateZone(); return }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteZone(); return }
      if (event.key === "Enter") { event.preventDefault(); const element = zoneEditable(selected.id); if (element) focusAt(element, null); return }
      if (event.key === "Escape") { setSelectedId(null); return }
      const step = event.shiftKey ? 10 : 1
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const move = moves[event.key]
      if (move) { event.preventDefault(); changeZone(selected.id, (zone) => ({ ...zone, x: zone.x + move[0], y: zone.y + move[1] }), "nudge") }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })

  /* ----- ouvrir, créer ----- */

  function guard(action: () => void) {
    if (dirty) setPendingSwitch(() => action)
    else action()
  }

  function resetEditing() {
    setSelectedId(null); setEditingId(null); setHistory({ past: [], future: [] }); setOverflowing({}); setMessage(null)
    setContentKeys((keys) => Object.fromEntries(Object.entries(keys).map(([id, value]) => [id, value + 1])))
  }

  function open(document: CampaignDocumentRecord) {
    guard(() => {
      if (draft?.uploadPreview) URL.revokeObjectURL(draft.uploadPreview)
      const next = draftOf(document)
      resetEditing()
      setDraft(next)
      setSavedSignature(signature(next))
    })
  }

  function create(background: DocumentBackground, file?: File) {
    const content: DocumentContent = background.kind === "builtin"
      ? documentFromBuiltin(background.key)
      : { version: 1, height: DOCUMENT_WIDTH, zones: [newDocumentZone({ x: 120, y: 120, width: 760, height: 260, size: 34, paragraphs: [[{ text: "Écris ici le contenu du document…" }]] })] }
    const next: Draft = {
      id: crypto.randomUUID(), isNew: true, title: "Nouveau document", sessionId: initialSessionId && sessions.some((session) => session.id === initialSessionId) ? initialSessionId : "",
      background, content, uploadFile: file ?? null, uploadPreview: file ? URL.createObjectURL(file) : "", renderVersion: "", updatedAt: "",
    }
    resetEditing()
    setDraft(next)
    setSavedSignature("")
    setChoosing(false)
  }

  function changeBackground(background: DocumentBackground, file?: File) {
    if (!draft) return
    if (draft.uploadPreview) URL.revokeObjectURL(draft.uploadPreview)
    setDraft({ ...draft, background, uploadFile: file ?? null, uploadPreview: file ? URL.createObjectURL(file) : "" })
    setChangingBackground(false)
  }

  function restoreBackup() {
    if (!backup) return
    const restored: Draft = { ...backup }
    resetEditing()
    setDraft(restored)
    const original = documents.find((document) => document.id === restored.id)
    setSavedSignature(original ? signature(draftOf(original)) : "")
    setBackup(null)
  }
  function dropBackup() {
    try { window.localStorage.removeItem(backupKey(campaignId)) } catch { /* rien à effacer */ }
    setBackup(null)
  }

  /* ----- enregistrer ----- */

  const backgroundSrc = draft ? backgroundSource(draft.background, draft.uploadPreview || documentBackgroundUrl(campaignId, draft)) : ""

  async function save() {
    if (!draft || saving) return
    const snapshot = draft
    setSaving("render"); setMessage(null)
    try {
      const image = backgroundSrc ? await loadImage(backgroundSrc) : null
      const render = await canvasBlob(await renderDocumentCanvas(snapshot.content, image, DOCUMENT_RENDER_WIDTH), "image/webp", 0.9)
      const print = await canvasBlob(await renderDocumentCanvas(snapshot.content, image, DOCUMENT_RENDER_WIDTH, "#ffffff"), "image/jpeg", 0.9)
      setSaving("upload")
      const form = new FormData()
      form.append("document", JSON.stringify({ id: snapshot.id, title: snapshot.title, sessionId: snapshot.sessionId, background: snapshot.background, content: snapshot.content }))
      form.append("render", new File([render], render.type === "image/webp" ? "rendu.webp" : "rendu.png", { type: render.type }))
      form.append("print", new File([print], "impression.jpg", { type: "image/jpeg" }))
      if (snapshot.uploadFile) form.append("background", snapshot.uploadFile)
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/documents`, { method: "POST", body: form })
      const payload = (await response.json().catch(() => ({}))) as { document?: CampaignDocumentRecord; error?: string }
      if (!response.ok || !payload.document) throw new Error(payload.error || "Le document n’a pas pu être enregistré.")
      const stored = payload.document
      setDocuments((current) => current.some((document) => document.id === stored.id) ? current.map((document) => document.id === stored.id ? stored : document) : [...current, stored])
      const kept: Draft = { ...snapshot, isNew: false, uploadFile: null, renderVersion: stored.renderVersion, updatedAt: stored.updatedAt }
      setDraft((current) => current && current.id === stored.id ? { ...current, isNew: false, uploadFile: current.uploadFile === snapshot.uploadFile ? null : current.uploadFile, renderVersion: stored.renderVersion, updatedAt: stored.updatedAt } : current)
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
    if (draft.isNew) { setDraft(null); setSavedSignature(""); setDeleting(false); return }
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(draft.id)}`, { method: "DELETE" })
      if (!response.ok) throw new Error("DELETE_FAILED")
      setDocuments((current) => current.filter((document) => document.id !== draft.id))
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

  const anyOverflow = selected ? overflowing[selected.id] : false
  const saved = draft && !draft.isNew ? documents.find((document) => document.id === draft.id) : undefined

  return <div className="mt-7 grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
    {/* Les documents de la campagne */}
    <aside className="grid gap-2 xl:sticky xl:top-4">
      <Button type="button" onClick={() => guard(() => setChoosing(true))}><Plus />Nouveau document</Button>
      <div className="grid max-h-[70vh] grid-cols-2 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-4 xl:grid-cols-1">
        {documents.map((document) => <button key={document.id} type="button" onClick={() => open(document)} className={cn("group flex items-center gap-2.5 rounded-xl border bg-card/60 p-1.5 text-left transition hover:border-primary/40 hover:bg-primary/5", draft?.id === document.id && "border-primary/60 bg-primary/8 ring-1 ring-primary/25")}>
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/50">
            {document.renderVersion
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={documentImageUrl(campaignId, document.id, document.renderVersion)} alt="" loading="lazy" className="size-full object-contain" />
              : <ScrollText className="size-5 text-primary/40" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{document.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{sessionName(document.sessionId) || "Sans session"}</span>
          </span>
        </button>)}
        {!documents.length && <p className="col-span-full rounded-xl border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">Aucun document pour l’instant.</p>}
      </div>
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
        {/* Le document : titre, session, fond, enregistrement */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/70 p-2.5">
          <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value.slice(0, 160) })} aria-label="Titre du document" placeholder="Titre du document" className="h-10 min-w-48 flex-1 border-transparent bg-transparent font-display text-xl font-semibold shadow-none focus-visible:border-input md:text-xl" />
          <NativeSelect value={draft.sessionId} onChange={(event) => setDraft({ ...draft, sessionId: event.target.value })} aria-label="Session du document" title="La session où ce document servira (Créateur de session, Roll20)">
            <NativeSelectOption value="">Aucune session</NativeSelectOption>
            {[...sessions].reverse().map((session) => <NativeSelectOption key={session.id} value={session.id}>{session.name}</NativeSelectOption>)}
          </NativeSelect>
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
              <p className={cn(hintText, "mt-2")}>Les zones de texte restent à leur place.</p>
            </PopoverContent>
          </Popover>
          <Button type="button" onClick={() => void save()} disabled={Boolean(saving) || (!dirty && Boolean(draft.renderVersion))} title="Ctrl+S">
            {saving ? <LoaderCircle className="animate-spin" /> : dirty || !draft.renderVersion ? <Save /> : <Check />}
            {saving === "render" ? "Dessin du document…" : saving === "upload" ? "Enregistrement…" : dirty || !draft.renderVersion ? "Enregistrer" : "Enregistré"}
          </Button>
        </div>

        {/* La mise en forme de la zone choisie */}
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-2xl border bg-background/95 p-1.5 shadow-sm backdrop-blur">
          <Button type="button" size="sm" variant="secondary" onMouseDown={(event) => event.preventDefault()} onClick={() => addZone()} title="Ajouter une zone de texte (ou trace un rectangle sur le document)"><Plus />Zone</Button>
          <Separator />
          <FontPicker value={selected?.font ?? "fell"} disabled={!selected} onChange={(font) => patchSelected({ font }, "font")} />
          <NumberStepper label="Taille du texte" value={selected?.size ?? 30} min={6} max={400} step={2} disabled={!selected} onChange={(size) => patchSelected({ size }, "size")} />
          <Separator />
          <ToolButton label="Gras (Ctrl+B)" active={Boolean(editingId) && formats.bold} disabled={!selected} onClick={() => format("bold")}><Bold className="size-4" /></ToolButton>
          <ToolButton label="Italique (Ctrl+I)" active={Boolean(editingId) && formats.italic} disabled={!selected} onClick={() => format("italic")}><Italic className="size-4" /></ToolButton>
          <ToolButton label="Souligné (Ctrl+U)" active={Boolean(editingId) && formats.underline} disabled={!selected} onClick={() => format("underline")}><Underline className="size-4" /></ToolButton>
          <ToolButton label="Barré" active={Boolean(editingId) && formats.strike} disabled={!selected} onClick={() => format("strikeThrough")}><Strikethrough className="size-4" /></ToolButton>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" disabled={!selected} onMouseDown={(event) => event.preventDefault()} title="Couleur de l’encre (du texte choisi, sinon de toute la zone)" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-muted disabled:opacity-40">
                <span className="size-4 rounded-full border shadow-inner" style={{ backgroundColor: selected?.color ?? "#2b1d12" }} /><span className="text-xs">Encre</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2.5" onOpenAutoFocus={(event) => event.preventDefault()}>
              <p className={hintText}>Sur le texte choisi, ou toute la zone si rien n’est choisi.</p>
              <div className="mt-2 grid grid-cols-8 gap-1.5">
                {INKS.map((ink) => <button key={ink.color} type="button" title={ink.label} aria-label={ink.label} onMouseDown={(event) => event.preventDefault()} onClick={() => format("foreColor", ink.color)} className={cn("size-6 rounded-full border shadow-inner", selected?.color === ink.color && "ring-2 ring-primary ring-offset-1")} style={{ backgroundColor: ink.color }} />)}
              </div>
              <label className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">Couleur libre<input type="color" value={selected?.color ?? "#2b1d12"} onChange={(event) => format("foreColor", event.target.value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent" /></label>
            </PopoverContent>
          </Popover>
          <Separator />
          <Segmented<DocumentAlign> ariaLabel="Alignement" disabled={!selected} value={selected?.align ?? "left"} onChange={(align) => patchSelected({ align }, "align")} options={[
            { value: "left", label: "", icon: <AlignLeft className="size-3.5" />, title: "À gauche" },
            { value: "center", label: "", icon: <AlignCenter className="size-3.5" />, title: "Centré" },
            { value: "right", label: "", icon: <AlignRight className="size-3.5" />, title: "À droite" },
            { value: "justify", label: "", icon: <AlignJustify className="size-3.5" />, title: "Justifié" },
          ]} />
          <Segmented<DocumentVerticalAlign> ariaLabel="Position verticale" disabled={!selected} value={selected?.valign ?? "top"} onChange={(valign) => patchSelected({ valign }, "valign")} options={[
            { value: "top", label: "", icon: <AlignVerticalJustifyStart className="size-3.5" />, title: "En haut de la zone" },
            { value: "middle", label: "", icon: <AlignVerticalJustifyCenter className="size-3.5" />, title: "Au milieu de la zone" },
            { value: "bottom", label: "", icon: <AlignVerticalJustifyEnd className="size-3.5" />, title: "En bas de la zone" },
          ]} />
          <Separator />
          <Popover>
            <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" disabled={!selected} onMouseDown={(event) => event.preventDefault()} title="Inclinaison, interligne, espacement, opacité"><RotateCcw />{selected ? `${Math.round(selected.rotation)}°` : "Réglages"}</Button></PopoverTrigger>
            <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
              {selected && <>
                <Range text="Inclinaison" value={selected.rotation} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(rotation) => patchSelected({ rotation }, "rotation")} />
                <div className="flex flex-wrap gap-1">{[-15, -5, 0, 5, 15, 90].map((angle) => <Button key={angle} type="button" size="xs" variant={Math.round(selected.rotation) === angle ? "secondary" : "ghost"} onClick={() => patchSelected({ rotation: angle }, "rotation-preset")}>{angle > 0 ? `+${angle}` : angle}°</Button>)}</div>
                <Range text="Interligne" value={selected.lineHeight} min={0.8} max={2.6} step={0.05} format={(value) => value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} onChange={(lineHeight) => patchSelected({ lineHeight }, "lineHeight")} />
                <Range text="Espacement des lettres" value={selected.letterSpacing} min={-3} max={30} step={0.5} format={(value) => value.toLocaleString("fr-FR")} onChange={(letterSpacing) => patchSelected({ letterSpacing }, "letterSpacing")} />
                <Range text="Opacité de l’encre" value={Math.round(selected.opacity * 100)} min={10} max={100} step={1} format={(value) => `${value} %`} onChange={(opacity) => patchSelected({ opacity: opacity / 100 }, "opacity")} />
                <Toggle checked={selected.ink} onChange={(ink) => patchSelected({ ink }, "ink")} title="L’encre se mêle au grain du papier au lieu de le recouvrir">Encre mêlée au papier</Toggle>
              </>}
            </PopoverContent>
          </Popover>
          <ToolButton label="Mettre au premier plan" disabled={!selected} onClick={() => reorder("front")}><ArrowUpToLine className="size-4" /></ToolButton>
          <ToolButton label="Mettre à l’arrière-plan" disabled={!selected} onClick={() => reorder("back")}><ArrowDownToLine className="size-4" /></ToolButton>
          <ToolButton label="Dupliquer la zone (Ctrl+D)" disabled={!selected} onClick={duplicateZone}><Copy className="size-4" /></ToolButton>
          <ToolButton label="Supprimer la zone (Suppr)" disabled={!selected} onClick={deleteZone}><Trash2 className="size-4 text-destructive/80" /></ToolButton>
        </div>

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
              onScale={setScale}
              onSelect={setSelectedId}
              onZoneChange={changeZone}
              onZoneText={zoneText}
              onCreateZone={(rect) => addZone(rect)}
              onEditing={editing}
              onOverflow={overflow}
              onBackgroundSize={backgroundSize}
            />
          </div>
        </div>
        <p className={cn(hintText, "text-center")}>Clique sur une zone pour écrire · trace un rectangle sur le fond pour en créer une · glisse le cadre pour la déplacer, un coin pour la redimensionner, la poignée ronde pour l’incliner (Maj : par 15°) · flèches : déplacer, Suppr : retirer, Ctrl+Z : annuler.</p>

        {/* Ce qu'on fait du document */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/60 p-2.5">
          <span className={cn(fieldLabel, "mr-auto")}>{draft.isNew ? "Pas encore enregistré" : saved?.updatedAt ? `Enregistré le ${new Date(saved.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}{dirty && !draft.isNew ? " · modifications non enregistrées" : ""}</span>
          <Button type="button" variant="outline" size="sm" disabled={!draft.renderVersion} title={draft.renderVersion ? "Voir le document comme le joueur le lira" : "Enregistre d’abord le document"} onClick={() => setViewing({ campaignId, documentId: draft.id, title: draft.title, version: draft.renderVersion })}><Eye />Aperçu</Button>
          <GiveDocumentButton campaignId={campaignId} documentId={draft.id} title={draft.title} players={players} disabledReason={!draft.renderVersion ? "Enregistre d’abord le document" : dirty ? "Enregistre d’abord tes modifications" : ""} onGiven={(text) => setMessage({ tone: "ok", text })} />
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 />Supprimer</Button>
        </div>
      </>}
    </section>

    <Dialog open={choosing} onOpenChange={setChoosing}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ImagePlus className="size-5 text-primary" />Un nouveau document</DialogTitle>
          <DialogDescription>Choisis son fond. Les fonds d’Eraser arrivent avec des zones de texte prêtes à remplir.</DialogDescription>
        </DialogHeader>
        <BackgroundChoices onBuiltin={(key) => create({ kind: "builtin", key })} onFile={(file) => create({ kind: "upload" }, file)} onUrl={(url) => create({ kind: "url", url })} />
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
