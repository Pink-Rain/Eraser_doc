/** La roue crantée d'Eraser Doc, sur sa ligne d'Administration › Extensions : administrateurs seulement. */
import { Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ExtensionSlotProps } from "@/lib/extension-api"

/** Les styles de l'extension, posés une fois (sa fenêtre en a besoin hors de ses pages). */
let styled = false

export function SettingsGear({ eraser, context }: ExtensionSlotProps) {
  if (context.id !== eraser.extension.id || eraser.account.role !== "admin") return null
  return <Button type="button" variant="ghost" size="icon" aria-label="Fonds des documents" title="Fonds des documents : ajouter des fonds, leurs mots-clés" onClick={async () => {
    try {
      // Les styles de l'extension (ceux qu'Eraser n'a pas déjà), pour sa fenêtre.
      if (!styled) { eraser.styles.add(eraser.file("main.css"), { href: true }); styled = true }
      const { BackgroundLibraryWindow } = await import("./background-library")
      eraser.ui.dialog(BackgroundLibraryWindow, { title: "Fonds des documents", description: "Les fonds proposés dans l’éditeur des documents, rangés par mots-clés.", wide: true })
    } catch {
      eraser.ui.toast("Les réglages n’ont pas pu s’ouvrir : recharge Eraser.", { tone: "erreur" })
    }
  }}>
    <Settings />
  </Button>
}
