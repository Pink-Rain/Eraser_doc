// Charge les modules comme à l'exécution : « @/… » vient de la copie d'Eraser ($ERASER_DIR ou
// ./eraser), celle contre laquelle l'extension se construit ; les fichiers de src/ par leur chemin.
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(import.meta.dirname, "..")
export const eraser = resolve(process.env.ERASER_DIR || join(root, "eraser"))
const { createServer } = await import(pathToFileURL(join(eraser, "node_modules", "vite", "dist", "node", "index.js")).href)

export const vite = await createServer({ appType: "custom", configFile: false, root: eraser, resolve: { alias: { "@": eraser } }, server: { middlewareMode: true, hmr: false }, logLevel: "error" })
/** Un module d'Eraser (« /lib/… »). */
export const loadEraser = (path) => vite.ssrLoadModule(path)
/** Un fichier de l'extension (« src/… »). */
export const loadOwn = (path) => vite.ssrLoadModule(`/@fs${join(root, path)}`)
