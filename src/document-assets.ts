/**
 * Ce qui ne sert qu'à l'éditeur des documents : les polices (leurs fichiers), les fonds fournis
 * (leurs images et leurs zones prêtes à remplir) et la fabrique des zones. Les clés
 * (`documentFontKeys`, `builtinBackgroundKeys`) et le nettoyage restent dans le modèle d'Eraser
 * (`@/lib/document-model`, emprunté), qui les vérifie à l'enregistrement : une police ou un fond
 * ajouté ici ajoute d'abord sa clé là-bas.
 *
 * Les fichiers (assets/, copiés dans dist/) sont servis à côté du module de l'extension.
 */
import { cleanDocumentZone, DEFAULT_INK, DOCUMENT_WIDTH, type BuiltinBackgroundKey, type DocumentContent, type DocumentFontKey, type DocumentParagraph, type DocumentZone } from "@/lib/document-model"

/** Un fichier de l'extension (assets/…), à l'adresse de la version installée. */
const asset = (path: string) => new URL(`./${path}`, import.meta.url).href

export type DocumentFont = {
  label: string
  /** La famille CSS (et le canvas) : la police embarquée d'abord, des remplaçantes ensuite. */
  family: string
  /** Les fichiers embarqués (assets/polices) ; aucun pour une police de Windows. */
  files: Array<{ file: string; weight: number; style: "normal" | "italic" }>
}

const font = (label: string, name: string, fallback: string, files: DocumentFont["files"] = []): DocumentFont => ({ label, family: `"${name}", ${fallback}`, files })
const embedded = (slug: string, variants: Array<[number, "normal" | "italic"]>) => variants.map(([weight, style]) => ({ file: asset(`polices/${slug}-latin-${weight}-${style}.woff2`), weight, style }))

export const documentFonts: Record<DocumentFontKey, DocumentFont> = {
  fell: font("Vieux livre", "IM Fell English", "Georgia, serif", embedded("im-fell-english", [[400, "normal"], [400, "italic"]])),
  cinzel: font("Inscription", "Cinzel", "Georgia, serif", embedded("cinzel", [[400, "normal"], [700, "normal"]])),
  dancing: font("Plume élégante", "Dancing Script", "\"Segoe Script\", cursive", embedded("dancing-script", [[400, "normal"], [700, "normal"]])),
  caveat: font("Écriture pressée", "Caveat", "\"Segoe Print\", cursive", embedded("caveat", [[400, "normal"], [700, "normal"]])),
  uncial: font("Onciale", "Uncial Antiqua", "Georgia, serif", embedded("uncial-antiqua", [[400, "normal"]])),
  medieval: font("Médiéval", "MedievalSharp", "Georgia, serif", embedded("medievalsharp", [[400, "normal"]])),
  pirata: font("Gothique", "Pirata One", "Georgia, serif", embedded("pirata-one", [[400, "normal"]])),
  georgia: font("Georgia", "Georgia", "\"Times New Roman\", serif"),
  manuscrit: font("Manuscrit", "Segoe Print", "\"Comic Sans MS\", cursive"),
  moderne: font("Moderne", "Segoe UI", "Arial, Helvetica, sans-serif"),
}

type ZonePreset = Pick<DocumentZone, "x" | "y" | "width" | "height" | "font" | "size" | "align"> & Partial<Pick<DocumentZone, "rotation" | "valign">> & { text: string }

/** Les fonds fournis (2000 × 2000, bords transparents) et des zones prêtes à remplir. */
export const builtinBackgrounds: Record<BuiltinBackgroundKey, { label: string; src: string; width: number; height: number; zones: ZonePreset[] }> = {
  parchemin: {
    label: "Parchemin brûlé", src: asset("fonds/parchemin.webp"), width: 2000, height: 2000,
    zones: [
      { x: 190, y: 110, width: 620, height: 110, font: "cinzel", size: 46, align: "center", valign: "middle", text: "Titre du document" },
      { x: 190, y: 245, width: 620, height: 640, font: "fell", size: 30, align: "justify", text: "Écris ici le contenu du document…" },
    ],
  },
  rouleau: {
    label: "Rouleau", src: asset("fonds/rouleau.webp"), width: 2000, height: 2000,
    zones: [
      { x: 185, y: 200, width: 630, height: 95, font: "cinzel", size: 44, align: "center", valign: "middle", text: "Proclamation" },
      { x: 185, y: 310, width: 630, height: 480, font: "dancing", size: 32, align: "center", text: "Écris ici le contenu du rouleau…" },
    ],
  },
  livre: {
    label: "Livre ouvert", src: asset("fonds/livre.webp"), width: 2000, height: 2000,
    zones: [
      { x: 175, y: 140, width: 290, height: 660, font: "fell", size: 24, align: "justify", text: "Page de gauche…" },
      { x: 530, y: 140, width: 290, height: 660, font: "fell", size: 24, align: "justify", text: "Page de droite…" },
    ],
  },
}

/**
 * L'image d'un fond de la bibliothèque (ajouté par un administrateur, roue de réglages), comme
 * `documentLibraryImageUrl` d'Eraser (une valeur nouvelle du modèle n'existe pas dans un Eraser
 * plus ancien : l'adresse est recopiée ici). Elle ne change jamais.
 */
export function libraryBackgroundUrl(id: string) {
  return `/api/documents/fonds/${encodeURIComponent(id)}/image`
}

/** Les mots-clés qui proposent un fond pour la couverture et pour l'image de fin (comme Eraser). */
export const COVER_KEYWORD = "Couverture"
export const END_KEYWORD = "Fin"

/** Un mot-clé comparé sans majuscules ni accents. */
export function keywordKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr")
}

export function plainParagraphs(content: string): DocumentParagraph[] {
  return content.split("\n").map((line) => line ? [{ text: line }] : [])
}

export function newDocumentZone(partial: Partial<DocumentZone> = {}): DocumentZone {
  return cleanDocumentZone({
    id: crypto.randomUUID(), x: 200, y: 200, width: 600, height: 200, rotation: 0, font: "fell", size: 30, color: DEFAULT_INK,
    align: "left", valign: "top", lineHeight: 1.35, letterSpacing: 0, opacity: 0.92, ink: true, paragraphs: plainParagraphs("Nouveau texte"),
    ...partial,
  }, 2000)!
}

/** Un nouveau document sur un fond fourni : ses zones prêtes à remplir. */
export function documentFromBuiltin(key: BuiltinBackgroundKey): DocumentContent {
  const background = builtinBackgrounds[key]
  const height = DOCUMENT_WIDTH * background.height / background.width
  const zones = background.zones.map(({ text: content, ...zone }) => newDocumentZone({ ...zone, paragraphs: plainParagraphs(content) }))
  return { version: 1, height, zones, lines: [], shapes: [], pictures: [], order: zones.map((zone) => zone.id) }
}

/** Un nouveau document sur un fond venu d'ailleurs (ordinateur, adresse) : une zone prête à remplir. */
export function documentOnOwnBackground(): DocumentContent {
  const zone = newDocumentZone({ x: 120, y: 120, width: 760, height: 260, size: 34, paragraphs: [[{ text: "Écris ici le contenu du document…" }]] })
  return { version: 1, height: DOCUMENT_WIDTH, zones: [zone], lines: [], shapes: [], pictures: [], order: [zone.id] }
}
