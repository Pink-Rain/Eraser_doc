/**
 * La fenêtre de la roue d'Eraser Doc (Administration › Extensions, administrateurs) : la
 * bibliothèque des fonds de documents. On y ajoute une image (allégée sous 4 Mo, comme un fond
 * importé), on lui donne un nom et des mots-clés, on les change, on la retire ; on change aussi les
 * mots-clés des fonds fournis. L'éditeur range les fonds par mots-clés ; « Couverture » et « Fin »
 * proposent d'abord un fond pour la couverture et pour l'image de fin.
 *
 * Tout passe par l'API d'Eraser (`/api/documents/fonds`), qui garde la liste sur le serveur partagé
 * et les images dans Drive : toutes les campagnes et toutes les installations les voient.
 */
import { useEffect, useState, type FormEvent } from "react"
import { ImagePlus, LoaderCircle, Plus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { builtinBackgroundKeys, type BuiltinBackgroundKey, type DocumentLibraryBackground } from "@/lib/document-model"
import type { ExtensionDialogProps } from "@/lib/extension-api"
import { cn } from "@/lib/utils"

import { COVER_KEYWORD, END_KEYWORD, builtinBackgrounds, keywordKey, libraryBackgroundUrl } from "./document-assets"
import { fittedBackground } from "./document-upload"

type Library = { backgrounds: DocumentLibraryBackground[]; builtin: Record<BuiltinBackgroundKey, string[]> }

/** Les mots-clés écrits dans un champ : séparés par des virgules. */
const wordsOf = (value: string) => value.split(",").map((word) => word.replace(/\s+/g, " ").trim()).filter(Boolean)

/** Ajoute un mot-clé s'il n'y est pas déjà (à la casse et aux accents près). */
const withWord = (words: string[], word: string) => words.some((candidate) => keywordKey(candidate) === keywordKey(word)) ? words : [...words, word]

export function BackgroundLibraryWindow({ eraser }: ExtensionDialogProps) {
  const [library, setLibrary] = useState<Library | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const call = async <T,>(path: string, init?: RequestInit) => {
    const response = await eraser.eraser(path, init)
    const body = await response.json().catch(() => ({})) as T & { error?: string }
    if (response.status === 404) throw new Error("Cette version d’Eraser ne garde pas encore de fonds : « Chercher les mises à jour » dans la barre latérale.")
    if (!response.ok) throw new Error(body.error || "La bibliothèque des fonds n’a pas pu être modifiée.")
    return body
  }

  useEffect(() => {
    let alive = true
    eraser.eraser("/api/documents/fonds", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Library & { error?: string }
        if (!alive) return
        if (response.status === 404) setError("Cette version d’Eraser ne garde pas encore de fonds : « Chercher les mises à jour » dans la barre latérale.")
        else if (!response.ok) setError(body.error || "La bibliothèque des fonds n’a pas pu être lue.")
        else setLibrary({ backgrounds: body.backgrounds ?? [], builtin: body.builtin })
      })
      .catch(() => { if (alive) setError("Eraser ne répond pas : réessaie dans un instant.") })
    return () => { alive = false }
  }, [eraser])

  // Tous les mots-clés déjà donnés, proposés d'un clic (avec « Couverture » et « Fin »).
  const known = [...new Map([COVER_KEYWORD, END_KEYWORD, ...(library ? [...Object.values(library.builtin).flat(), ...library.backgrounds.flatMap((background) => background.keywords)] : [])]
    .map((word) => [keywordKey(word), word] as const)).values()].sort((left, right) => left.localeCompare(right, "fr"))

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key); setError("")
    try { await task() } catch (caught) { setError(caught instanceof Error ? caught.message : "La bibliothèque des fonds n’a pas pu être modifiée.") }
    setBusy("")
  }

  function add(file: File, name: string, keywords: string[]) {
    return run("ajout", async () => {
      // Allégée comme un fond importé : l'éditeur la relit à chaque page qui s'en sert.
      const image = await fittedBackground(file, 4 * 1024 * 1024)
      const form = new FormData()
      form.append("image", image)
      form.append("name", name)
      form.append("keywords", JSON.stringify(keywords))
      const { background } = await call<{ background: DocumentLibraryBackground }>("/api/documents/fonds", { method: "POST", body: form })
      setLibrary((current) => current && { ...current, backgrounds: [...current.backgrounds, background].sort((left, right) => left.name.localeCompare(right.name, "fr")) })
    })
  }

  function update(id: string, change: { name?: string; keywords?: string[] }) {
    return run(id, async () => {
      const { background } = await call<{ background: DocumentLibraryBackground }>(`/api/documents/fonds/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) })
      setLibrary((current) => current && { ...current, backgrounds: current.backgrounds.map((candidate) => candidate.id === id ? background : candidate) })
    })
  }

  async function remove(background: DocumentLibraryBackground) {
    const ok = await eraser.ui.confirm(`« ${background.name} » ne sera plus proposé. Les documents qui s’en servent le gardent.`, { title: "Retirer ce fond ?", confirm: "Retirer", destructive: true })
    if (!ok) return
    await run(background.id, async () => {
      await call(`/api/documents/fonds/${encodeURIComponent(background.id)}`, { method: "DELETE" })
      setLibrary((current) => current && { ...current, backgrounds: current.backgrounds.filter((candidate) => candidate.id !== background.id) })
    })
  }

  function setBuiltin(key: BuiltinBackgroundKey, keywords: string[]) {
    return run(key, async () => {
      const { builtin } = await call<{ builtin: Library["builtin"] }>("/api/documents/fonds", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ builtin: { [key]: keywords } }) })
      setLibrary((current) => current && { ...current, builtin })
    })
  }

  if (!library) return <div aria-busy={!error} className="grid min-h-40 place-items-center text-sm text-muted-foreground">
    {error ? <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-destructive">{error}</p> : <LoaderCircle className="size-5 animate-spin" aria-label="Lecture des fonds…" />}
  </div>

  return <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1">
    <p className="text-sm text-muted-foreground">Dans l’éditeur, chaque choix de fond est rangé par mot-clé. Un fond marqué <b>{COVER_KEYWORD}</b> est proposé d’abord pour la couverture d’un document, un fond marqué <b>{END_KEYWORD}</b> pour son image de fin.</p>
    {error && <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">{error}</p>}

    <AddBackground known={known} busy={busy === "ajout"} onAdd={(file, name, keywords) => void add(file, name, keywords)} />

    <section aria-label="Les fonds ajoutés" className="grid gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Les fonds ajoutés · {library.backgrounds.length}</p>
      {library.backgrounds.length
        ? <div className="grid gap-2 sm:grid-cols-2">{library.backgrounds.map((background) => <BackgroundRow key={background.id} src={libraryBackgroundUrl(background.id)} name={background.name} keywords={background.keywords} known={known} busy={busy === background.id}
          onName={(name) => void update(background.id, { name })} onKeywords={(keywords) => void update(background.id, { keywords })} onRemove={() => void remove(background)} />)}</div>
        : <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">Aucun fond ajouté pour l’instant.</p>}
    </section>

    <section aria-label="Les fonds fournis" className="grid gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Les fonds fournis avec Eraser Doc</p>
      <div className="grid gap-2 sm:grid-cols-2">{builtinBackgroundKeys.map((key) => <BackgroundRow key={key} src={eraser.file(`fonds/${key}.webp`)} name={builtinBackgrounds[key].label} keywords={library.builtin[key] ?? []} known={known} busy={busy === key} onKeywords={(keywords) => void setBuiltin(key, keywords)} />)}</div>
    </section>
  </div>
}

/** Ajouter un fond : une image de l'ordinateur, son nom, ses mots-clés. */
function AddBackground({ known, busy, onAdd }: { known: string[]; busy: boolean; onAdd: (file: File, name: string, keywords: string[]) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [name, setName] = useState("")
  const [keywords, setKeywords] = useState<string[]>([])
  const [problem, setProblem] = useState("")
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function choose(next: File | undefined) {
    if (!next) return
    if (!next.type.startsWith("image/") || next.size > 15 * 1024 * 1024) { setProblem("Choisis une image de 15 Mo au plus."); return }
    setProblem("")
    setFile(next)
    setPreview(URL.createObjectURL(next))
    if (!name) setName(next.name.replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").slice(0, 80))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) { setProblem("Choisis d’abord une image."); return }
    onAdd(file, name.trim() || "Fond", keywords)
    setFile(null); setPreview(""); setName(""); setKeywords([])
  }

  return <form onSubmit={submit} className="grid gap-3 rounded-2xl border bg-card/60 p-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
    <label className="grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed bg-background text-muted-foreground transition hover:border-primary/50 hover:text-primary">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview ? <img src={preview} alt="" className="size-full object-contain" /> : <span className="grid place-items-center gap-1 text-center text-xs"><ImagePlus className="size-5" />Une image</span>}
      <input type="file" accept="image/*" className="sr-only" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = "" }} />
    </label>
    <div className="grid content-start gap-2">
      <Input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="Nom du fond" aria-label="Nom du fond" />
      <KeywordsEditor keywords={keywords} known={known} onChange={setKeywords} />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <Button type="submit" size="sm" disabled={busy || !file} className="justify-self-start">{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}Ajouter ce fond</Button>
    </div>
  </form>
}

/** Un fond de la liste : son image, son nom (s'il se change), ses mots-clés, et le retirer. */
function BackgroundRow({ src, name, keywords, known, busy, onName, onKeywords, onRemove }: { src: string; name: string; keywords: string[]; known: string[]; busy: boolean; onName?: (name: string) => void; onKeywords: (keywords: string[]) => void; onRemove?: () => void }) {
  const [draft, setDraft] = useState(name)
  return <div className={cn("flex gap-2 rounded-xl border bg-card/60 p-2", busy && "opacity-70")} aria-busy={busy}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-muted/40 object-contain" />
    <div className="grid min-w-0 flex-1 content-start gap-1.5">
      <div className="flex items-center gap-1">
        {onName
          ? <Input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 80))} onBlur={() => { if (draft.trim() && draft.trim() !== name) onName(draft.trim()) }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} aria-label={`Nom de ${name}`} className="h-8 min-w-0 flex-1 text-sm font-medium" />
          : <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{name}</p>}
        {busy && <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        {onRemove && <Button type="button" variant="ghost" size="icon-sm" title="Retirer ce fond (les documents qui s’en servent le gardent)" aria-label={`Retirer ${name}`} onClick={onRemove}><Trash2 className="text-destructive/80" /></Button>}
      </div>
      <KeywordsEditor keywords={keywords} known={known} onChange={onKeywords} compact />
    </div>
  </div>
}

/** Les mots-clés d'un fond : des pastilles (× pour en retirer), un champ (Entrée ou virgule pour en ajouter), et ceux déjà connus d'un clic. */
function KeywordsEditor({ keywords, known, onChange, compact = false }: { keywords: string[]; known: string[]; onChange: (keywords: string[]) => void; compact?: boolean }) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const commit = () => {
    const words = wordsOf(text)
    if (!words.length) return
    onChange(words.reduce(withWord, keywords).slice(0, 12))
    setText("")
  }
  const suggestions = known.filter((word) => !keywords.some((candidate) => keywordKey(candidate) === keywordKey(word)))
  return <div className="grid gap-1">
    <div className="flex flex-wrap items-center gap-1">
      {keywords.map((word) => <span key={word} className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium", keywordKey(word) === keywordKey(COVER_KEYWORD) || keywordKey(word) === keywordKey(END_KEYWORD) ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-primary/10 text-primary")}>
        {word}<button type="button" onClick={() => onChange(keywords.filter((candidate) => candidate !== word))} aria-label={`Retirer le mot-clé ${word}`} className="rounded-full p-0.5 hover:bg-black/10"><X className="size-3" /></button>
      </span>)}
      <input value={text} onChange={(event) => {
        const value = event.target.value
        // Une virgule termine un mot-clé (on peut aussi en coller plusieurs d'un coup).
        if (!value.includes(",")) { setText(value.slice(0, 40)); return }
        const words = wordsOf(value)
        if (words.length) onChange(words.reduce(withWord, keywords).slice(0, 12))
        setText("")
      }} onFocus={() => setOpen(true)} onBlur={() => { commit(); setTimeout(() => setOpen(false), 150) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit() } }}
        placeholder={keywords.length ? "+ mot-clé" : "Mots-clés (Entrée pour ajouter)"} aria-label="Ajouter un mot-clé" className={cn("min-w-24 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-primary/60", compact ? "h-7" : "h-8")} />
    </div>
    {open && suggestions.length > 0 && <div className="flex flex-wrap gap-1">{suggestions.slice(0, 12).map((word) => <button key={word} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange(withWord(keywords, word))} className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary">+ {word}</button>)}</div>}
  </div>
}
