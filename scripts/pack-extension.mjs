#!/usr/bin/env node
// Fabrique une version publiable d'une extension d'Eraser (voir lib/extensions.ts) :
//   release/eraser-extension.json     le manifeste (identifiant, version, API, empreinte)
//   release/eraser-extension.pack.gz  tous les fichiers de dist/, en un JSON compressé
// Les deux fichiers sont ensuite joints à une Release GitHub du dépôt de l'extension.
//
// Ce script est recopié tel quel dans chaque dépôt d'extension. Il lit, dans le package.json
// du dossier courant, `version` et le champ `eraserExtension` :
//   { "id": "map", "api": 1, "entry": "main.js", "styles": ["main.css"], "server": "server.mjs" }
// (`styles` et `server` sont facultatifs). Usage : node scripts/pack-extension.mjs [dist] [release]
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { gzipSync } from "node:zlib"

export const PACK_FORMAT = "eraser-extension-pack"
export const MANIFEST_NAME = "eraser-extension.json"
export const PACK_NAME = "eraser-extension.pack.gz"

/** `files` : Map chemin relatif (« a/b.js ») → contenu. Rend le manifeste et le paquet. */
export function packExtension({ id, version, api, entry, styles = [], server = null, files }) {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error(`Identifiant d'extension invalide : ${id}`)
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z]+\.\d+)?$/i.test(String(version))) throw new Error(`Version invalide : ${version} (attendu : 1.2.3 ou 1.2.3-alpha.4)`)
  if (!Number.isInteger(api) || api < 1) throw new Error(`Version d'API invalide : ${api}`)
  for (const needed of [entry, ...styles, ...(server ? [server] : [])]) {
    if (!files.has(needed)) throw new Error(`Fichier absent du paquet : ${needed}`)
  }
  const content = {}
  for (const [path, data] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) content[path] = Buffer.from(data).toString("base64")
  const pack = gzipSync(Buffer.from(JSON.stringify({ format: PACK_FORMAT, files: content })), { level: 9 })
  const manifest = { id, version, api, entry, styles, server, pack: PACK_NAME, sha256: createHash("sha256").update(pack).digest("hex") }
  return { manifest, pack }
}

async function listFiles(root) {
  const files = new Map()
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.set(relative(root, path).split(sep).join("/"), await readFile(path))
    }
  }
  await walk(root)
  return files
}

async function main() {
  const [distArgument = "dist", outArgument = "release"] = process.argv.slice(2)
  const packageJson = JSON.parse(await readFile("package.json", "utf8"))
  const settings = packageJson.eraserExtension
  if (!settings || typeof settings !== "object") throw new Error("package.json n'a pas de champ « eraserExtension ».")
  const files = await listFiles(resolve(distArgument))
  const { manifest, pack } = packExtension({ ...settings, version: packageJson.version, files })
  await mkdir(resolve(outArgument), { recursive: true })
  await writeFile(join(resolve(outArgument), PACK_NAME), pack)
  await writeFile(join(resolve(outArgument), MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${manifest.id} ${manifest.version} : ${files.size} fichiers, ${pack.length} octets, sha256 ${manifest.sha256}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
