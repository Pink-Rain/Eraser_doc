import { useEffect, useState, type DragEvent, type FormEvent } from "react"
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, LayoutTemplate, MoreHorizontal, Pencil, ScrollText, Trash2, X } from "lucide-react"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { documentImageUrl, type CampaignDocumentRecord } from "@/lib/document-model"
import { cn } from "@/lib/utils"

/**
 * Les documents de la campagne, rangés par dossiers (un seul niveau) : ceux sans dossier d'abord,
 * puis chaque dossier, qui se replie. Un document se range en le glissant sur un dossier (ou hors
 * des dossiers), ou depuis le menu « Dossier » de l'éditeur. Un dossier vide n'existe que sur cet
 * ordinateur, le temps d'y ranger un premier document.
 */

const DRAG_TYPE = "application/x-eraser-document"
const collapsedKey = (campaignId: string) => `eraser-document-folders-closed:${campaignId}`

export function folderNames(documents: CampaignDocumentRecord[], extra: string[]) {
  return [...new Set([...documents.map((document) => document.folder ?? "").filter(Boolean), ...extra])].sort((left, right) => left.localeCompare(right, "fr"))
}

export function DocumentLibrary({ campaignId, documents, currentId, emptyFolders, sessionName, organize, onOpen, onMove, onCreateFolder, onRenameFolder, onDeleteFolder }: {
  campaignId: string
  documents: CampaignDocumentRecord[]
  currentId: string | null
  /** Les dossiers créés ici et encore vides. */
  emptyFolders: string[]
  sessionName: (id: string) => string
  /** Eraser sait-il garder les dossiers ? (sinon, la liste reste à plat) */
  organize: boolean
  onOpen: (document: CampaignDocumentRecord) => void
  onMove: (document: CampaignDocumentRecord, folder: string) => void
  onCreateFolder: (name: string) => void
  onRenameFolder: (from: string, to: string) => void
  onDeleteFolder: (name: string) => void
}) {
  const folders = organize ? folderNames(documents, emptyFolders) : []
  const [closed, setClosed] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const [naming, setNaming] = useState<{ from: string | null; value: string } | null>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(collapsedKey(campaignId)) || "[]") as unknown
      if (Array.isArray(saved)) queueMicrotask(() => setClosed(saved.filter((name): name is string => typeof name === "string")))
    } catch { /* rien de gardé */ }
  }, [campaignId])

  function toggle(name: string) {
    const next = closed.includes(name) ? closed.filter((candidate) => candidate !== name) : [...closed, name]
    setClosed(next)
    try { window.localStorage.setItem(collapsedKey(campaignId), JSON.stringify(next)) } catch { /* stockage plein */ }
  }

  function drop(event: DragEvent, folder: string) {
    event.preventDefault()
    setOver(null)
    setDragging(false)
    const id = event.dataTransfer.getData(DRAG_TYPE)
    const document = documents.find((candidate) => candidate.id === id)
    if (document && (document.folder ?? "") !== folder) onMove(document, folder)
  }
  const dropTarget = (folder: string) => organize ? {
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(folder) } },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => current === folder ? null : current) },
    onDrop: (event: DragEvent) => drop(event, folder),
  } : {}

  function submitName(event: FormEvent) {
    event.preventDefault()
    if (!naming) return
    const name = naming.value.replace(/\s+/g, " ").trim().slice(0, 80)
    if (name && naming.from === null) onCreateFolder(name)
    else if (name && naming.from !== null && name !== naming.from) onRenameFolder(naming.from, name)
    setNaming(null)
  }

  const item = (document: CampaignDocumentRecord) => <button
    key={document.id}
    type="button"
    draggable={organize}
    onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, document.id); event.dataTransfer.effectAllowed = "move"; setDragging(true) }}
    onDragEnd={() => { setDragging(false); setOver(null) }}
    onClick={() => onOpen(document)}
    className={cn("group flex items-center gap-2.5 rounded-xl border bg-card/60 p-1.5 text-left transition hover:border-primary/40 hover:bg-primary/5", currentId === document.id && "border-primary/60 bg-primary/8 ring-1 ring-primary/25")}
  >
    <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/50">
      {document.renderVersion
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={documentImageUrl(campaignId, document.id, document.renderVersion)} alt="" loading="lazy" draggable={false} className="size-full object-contain" />
        : <ScrollText className="size-5 text-primary/40" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold">{document.title}</span>
      <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
        {document.template && <span className="inline-flex items-center gap-0.5 text-primary"><LayoutTemplate className="size-3" />Modèle ·</span>}
        {sessionName(document.sessionId) || "Sans session"}
      </span>
    </span>
  </button>

  const loose = documents.filter((document) => !organize || !document.folder)
  const nameForm = (from: string | null) => <form onSubmit={submitName} className="flex items-center gap-1">
    <Input autoFocus value={naming?.value ?? ""} onChange={(event) => setNaming((current) => current && { ...current, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setNaming(null) }} placeholder="Nom du dossier" aria-label="Nom du dossier" className="h-8 min-w-0 flex-1 text-sm" />
    <button type="submit" title={from === null ? "Créer le dossier" : "Renommer"} aria-label={from === null ? "Créer le dossier" : "Renommer"} className="flex size-8 items-center justify-center rounded-md text-primary hover:bg-primary/10"><Check className="size-4" /></button>
    <button type="button" title="Annuler" aria-label="Annuler" onClick={() => setNaming(null)} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
  </form>

  return <div className="grid gap-2">
    {organize && (naming?.from === null ? nameForm(null) : <button type="button" onClick={() => setNaming({ from: null, value: "" })} className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
      <FolderPlus className="size-3.5" />Nouveau dossier
    </button>)}
    <div className="grid max-h-[70vh] gap-2 overflow-y-auto pr-0.5">
      <div {...dropTarget("")} className={cn("grid grid-cols-2 gap-2 rounded-xl sm:grid-cols-4 xl:grid-cols-1", dragging && "min-h-10 outline-1 outline-dashed outline-primary/30", over === "" && "bg-primary/8 outline-primary")}>
        {loose.map(item)}
        {dragging && !loose.length && <p className="col-span-full py-2 text-center text-[11px] text-muted-foreground">Hors des dossiers</p>}
      </div>
      {folders.map((folder) => {
        const inside = documents.filter((document) => document.folder === folder)
        const open = !closed.includes(folder)
        return <div key={folder} {...dropTarget(folder)} className={cn("grid gap-1.5 rounded-xl border border-transparent p-0.5 transition", over === folder && "border-primary/50 bg-primary/8")}>
          {naming?.from === folder ? nameForm(folder) : <div className="flex items-center gap-1">
            <button type="button" onClick={() => toggle(folder)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-muted/60">
              {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
              {open ? <FolderOpen className="size-4 shrink-0 text-primary/70" /> : <Folder className="size-4 shrink-0 text-primary/70" />}
              <span className="truncate">{folder}</span>
              <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">{inside.length}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" title="Le dossier" aria-label={`Le dossier ${folder}`} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setNaming({ from: folder, value: folder })}><Pencil />Renommer</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => onDeleteFolder(folder)}><Trash2 />Retirer le dossier</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>}
          {open && <div className="grid grid-cols-2 gap-2 pl-3 sm:grid-cols-4 xl:grid-cols-1">
            {inside.map(item)}
            {!inside.length && <p className="col-span-full rounded-lg border border-dashed px-2 py-2.5 text-center text-[11px] text-muted-foreground">Glisse un document ici.</p>}
          </div>}
        </div>
      })}
      {!documents.length && <p className="rounded-xl border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">Aucun document pour l’instant.</p>}
    </div>
  </div>
}
