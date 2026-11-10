import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Image as ImageIcon, Layers, PenTool, Shapes, Slash, Type } from "lucide-react"

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { hintText } from "@/components/eraser/editor-controls"
import type { DocumentBlendMode, DocumentContent } from "@/lib/document-model"
import { cn } from "@/lib/utils"

import { blendModes, elementLabel, orderedElements, type DocumentElement } from "./document-elements"

/** Les encres proposées (texte, lignes, plume). */
export const INKS = [
  { color: "#2b1d12", label: "Encre noire" },
  { color: "#5b3a1e", label: "Sépia" },
  { color: "#8b1a1a", label: "Rouge sang" },
  { color: "#1f3a5f", label: "Bleu nuit" },
  { color: "#2f4f2f", label: "Vert sombre" },
  { color: "#4b2a5e", label: "Violet" },
  { color: "#9a7417", label: "Or" },
  { color: "#f4ead6", label: "Craie" },
]

/** Le mode de fusion d'un élément avec ce qui est dessous. */
export function BlendSelect({ value, onChange, disabled }: { value: DocumentBlendMode; onChange: (mode: DocumentBlendMode) => void; disabled?: boolean }) {
  return <label className="grid gap-1 text-xs text-muted-foreground">
    Fusion avec ce qui est dessous
    <NativeSelect value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as DocumentBlendMode)} aria-label="Mode de fusion">
      {blendModes.map((mode) => <NativeSelectOption key={mode.value} value={mode.value}>{mode.label}</NativeSelectOption>)}
    </NativeSelect>
  </label>
}

/** Une couleur d'encre : les encres proposées et une couleur libre. */
export function InkPicker({ value, onPick, title, hint, disabled, label = "Encre" }: { value: string; onPick: (color: string) => void; title: string; hint?: string; disabled?: boolean; label?: string }) {
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} title={title} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-muted disabled:opacity-40">
        <span className="size-4 rounded-full border shadow-inner" style={{ backgroundColor: value }} /><span className="text-xs">{label}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-2.5" onOpenAutoFocus={(event) => event.preventDefault()}>
      {hint && <p className={hintText}>{hint}</p>}
      <div className={cn("grid grid-cols-8 gap-1.5", hint && "mt-2")}>
        {INKS.map((ink) => <button key={ink.color} type="button" title={ink.label} aria-label={ink.label} onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(ink.color)} className={cn("size-6 rounded-full border shadow-inner", value === ink.color && "ring-2 ring-primary ring-offset-1")} style={{ backgroundColor: ink.color }} />)}
      </div>
      <label className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">Couleur libre<input type="color" value={value} onChange={(event) => onPick(event.target.value)} className="h-7 w-12 cursor-pointer rounded border bg-transparent" /></label>
    </PopoverContent>
  </Popover>
}

const elementIcon = (element: DocumentElement): ReactNode => element.kind === "zone" ? <Type className="size-3.5" />
  : element.kind === "line" ? <Slash className="size-3.5" />
    : element.kind === "shape" ? <Shapes className="size-3.5" />
    : element.picture.kind === "drawing" ? <PenTool className="size-3.5" /> : <ImageIcon className="size-3.5" />

/** Les calques du document, du plus haut au plus bas : choisir, monter, descendre. */
export function LayersPopover({ content, selectedId, onSelect, onMove, disabled }: { content: DocumentContent; selectedId: string | null; onSelect: (id: string) => void; onMove: (id: string, move: 1 | -1) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const elements = orderedElements(content).reverse()
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} title="Les calques : ce qui passe devant ou derrière" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
        <Layers className="size-4" />Calques
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 p-1.5" onOpenAutoFocus={(event) => event.preventDefault()}>
      <p className={cn(hintText, "px-2 pb-1.5 pt-1")}>Du plus haut au plus bas. Le mode de fusion d’un calque le mêle à tout ce qui est dessous.</p>
      {!elements.length && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Aucun élément.</p>}
      <div className="grid max-h-80 gap-0.5 overflow-y-auto">
        {elements.map((element, index) => <div key={element.id} className={cn("group flex items-center gap-1 rounded-lg pl-2 pr-1", element.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(element.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm">
            <span className="text-muted-foreground">{elementIcon(element)}</span>
            <span className="truncate">{elementLabel(element)}</span>
          </button>
          <button type="button" title="Monter" aria-label="Monter le calque" disabled={index === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => onMove(element.id, 1)} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
          <button type="button" title="Descendre" aria-label="Descendre le calque" disabled={index === elements.length - 1} onMouseDown={(event) => event.preventDefault()} onClick={() => onMove(element.id, -1)} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
        </div>)}
      </div>
    </PopoverContent>
  </Popover>
}
