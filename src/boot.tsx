/**
 * Le démarrage de l'extension (API 4), sur chaque ordinateur : la roue de réglages sur sa ligne
 * d'Administration › Extensions. Le reste (l'éditeur des documents) est sa page (`main.js`).
 */
import type { Eraser } from "@/lib/extension-api"

import { SettingsGear } from "./settings-gear"

export function activate(eraser: Eraser) {
  eraser.slots.add("administration.extension", SettingsGear)
}
