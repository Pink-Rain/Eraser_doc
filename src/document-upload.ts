import { DOCUMENT_RENDER_WIDTH } from "@/lib/document-model"

import { canvasBlob, loadImage } from "./document-render"

/**
 * L'envoi d'un document à Eraser. Le serveur local d'un Eraser d'avant l'alpha 286 (vinext) prend
 * tout envoi de fichiers (`multipart/form-data`), même vers `/api/…`, pour une « action serveur »
 * et le refuse au-delà de 1 Mo (413 Payload Too Large), avant même la route des documents ;
 * depuis, il accepte 40 Mo et le dit (`features` : « envoi-unique ») : le document part alors en
 * un seul envoi (une seule lecture et une seule écriture dans Google Sheets). Or un rendu (WebP) et son
 * impression (JPEG) font chacun de 0,4 à 1 Mo, et un fond importé bien plus.
 *
 * Chaque image est donc préparée pour tenir sous cette limite (la qualité baisse d'abord, la
 * taille seulement si cela ne suffit pas), puis le document part en autant d'envois qu'il faut :
 * les fonds importés d'abord (le serveur veut le fond de chaque page dès le premier envoi qui la
 * nomme), les images posées et les calques de dessin, puis les rendus et les impressions des pages.
 * Chaque envoi réécrit la même ligne du document ; le dernier fait foi.
 */

/** La limite d'un Eraser d'avant l'alpha 286 (1 Mo par envoi), moins une marge. */
export const SMALL_REQUESTS = 1024 * 1024 - 16 * 1024
/** Un Eraser qui accepte un document entier en un envoi (`features` : « envoi-unique », 40 Mo). */
export const LARGE_REQUESTS = 30 * 1024 * 1024
/** Une image ne dépasse jamais ce qu'Eraser accepte (15 Mo), moins une marge. */
const IMAGE_LIMIT = 14 * 1024 * 1024
/** En dessous, une image n'est plus réduite : elle part telle quelle. */
const MIN_WIDTH = 480

/**
 * Une image d'un envoi : `background`, `render`, `print` (la première page), `background-<id de la
 * page>`, `render-<n>`, `print-<n>` (les pages suivantes, n à partir de 2), ou `piece-<nom>` (image
 * posée, calque de dessin).
 */
export type DocumentPart = { field: "background" | `background-${string}` | "render" | `render-${number}` | "print" | `print-${number}` | `piece-${string}`; file: File }

/** Ce qui reste pour une image dans un envoi, une fois le document (JSON) compté. */
export function partBudget(documentJson: string, limit = SMALL_REQUESTS) {
  return Math.min(IMAGE_LIMIT, limit - new Blob([documentJson]).size - 2048)
}

function scaledCanvas(source: HTMLCanvasElement, factor: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(source.width * factor))
  canvas.height = Math.max(1, Math.round(source.height * factor))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Le navigateur ne peut pas dessiner le document.")
  context.imageSmoothingQuality = "high"
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Le canvas en image d'au plus `maxBytes` : la qualité baisse d'abord, puis la taille. */
export async function fittedBlob(canvas: HTMLCanvasElement, type: string, qualities: number[], maxBytes: number) {
  let source = canvas
  for (;;) {
    let blob: Blob | null = null
    for (const quality of qualities) {
      blob = await canvasBlob(source, type, quality)
      if (blob.size <= maxBytes) return blob
      // Format de repli sans qualité réglable (PNG) : seule la taille peut encore baisser.
      if (blob.type !== type) break
    }
    if (!blob || source.width * 0.8 < MIN_WIDTH) return blob ?? canvasBlob(source, type, qualities[0] ?? 0.9)
    source = scaledCanvas(source, 0.8)
  }
}

/**
 * Une image importée (fond, image posée), prête à partir : telle quelle si elle tient dans un envoi
 * (et que son format est `accepted`), sinon redessinée (au plus la largeur du rendu, en WebP, qui
 * garde la transparence) jusqu'à y tenir.
 */
export async function fittedBackground(file: File, maxBytes: number, accepted = /^image\//) {
  if (file.size <= maxBytes && accepted.test(file.type)) return file
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    const scale = Math.min(1, DOCUMENT_RENDER_WIDTH / Math.max(1, width))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Le navigateur ne peut pas dessiner le document.")
    context.imageSmoothingQuality = "high"
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await fittedBlob(canvas, "image/webp", [0.9, 0.8, 0.7], maxBytes)
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png"
    return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "fond"}.${extension}`, { type: blob.type })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function formOf(documentJson: string, parts: DocumentPart[]) {
  const form = new FormData()
  form.append("document", documentJson)
  for (const part of parts) form.append(part.field, part.file)
  return form
}

/** La taille exacte d'un envoi : le corps multipart tel que `fetch` l'enverra. */
async function formSize(form: FormData) {
  return (await new Response(form).blob()).size
}

/** Les envois d'un document, dans l'ordre : chacun sous la limite d'Eraser, le moins possible. */
export async function documentForms(documentJson: string, parts: DocumentPart[], limit = SMALL_REQUESTS) {
  const groups: DocumentPart[][] = []
  for (const part of parts) {
    const last = groups.at(-1)
    if (last && await formSize(formOf(documentJson, [...last, part])) <= limit) last.push(part)
    else groups.push([part])
  }
  if (!groups.length) groups.push([])
  return groups.map((group) => formOf(documentJson, group))
}
