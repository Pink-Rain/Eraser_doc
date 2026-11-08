// Vérifie les types de src/ avec ceux d'Eraser (« @/… » pointe vers sa copie, $ERASER_DIR ou
// ./eraser, dépendances installées). Seules les erreurs de src/ comptent : celles d'Eraser
// lui appartiennent.
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const eraser = resolve(process.env.ERASER_DIR || join(root, "eraser"))
await mkdir(join(root, "build"), { recursive: true })
const config = join(root, "build", "tsconfig.check.json")
await writeFile(config, JSON.stringify({
  extends: "../tsconfig.json",
  compilerOptions: {
    baseUrl: "..",
    // Ce qu'Eraser prête (« @/… », React, Next) se lit avec les types d'Eraser.
    paths: {
      "@/*": [`${relative(root, eraser)}/*`],
      "react": [`${relative(root, eraser)}/node_modules/@types/react`],
      "react/*": [`${relative(root, eraser)}/node_modules/@types/react/*`],
      "react-dom": [`${relative(root, eraser)}/node_modules/@types/react-dom`],
      "react-dom/*": [`${relative(root, eraser)}/node_modules/@types/react-dom/*`],
      "next/*": [`${relative(root, eraser)}/node_modules/next/*`],
    },
    typeRoots: [join(eraser, "node_modules", "@types")],
  },
  include: ["../src"],
}, null, 2))
let output = ""
try {
  execFileSync(join(eraser, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", config], { cwd: root, encoding: "utf8" })
} catch (error) {
  output = String(error.stdout || "")
}
const ours = output.split("\n").filter((line) => /^src[\\/]/.test(line.trim()))
if (ours.length) {
  console.error(ours.join("\n"))
  process.exit(1)
}
console.log("Types de src/ vérifiés.")
