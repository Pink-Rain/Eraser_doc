/**
 * Eraser Doc : l'éditeur des documents de campagne d'Eraser (lettres, parchemins, pages de
 * grimoire), publié comme extension. Eraser l'affiche dans sa coque à l'adresse
 * `/extension/doc/campagne/<id>` (`?document=` en ouvre un, `?nouveau=1` en commence un,
 * `&session=` le range dans cette session) et lui prête ses pièces : tout import « @/… » vient
 * d'Eraser, à la version installée (le modèle des documents, leur lecture, les composants).
 *
 * Eraser garde les données et les API (`/api/campaigns/<id>/documents…`), la lecture des
 * documents (inventaire, Créateur de session) et Roll20 ; ici, l'éditeur, son rendu (l'image que
 * reçoivent les joueurs et Roll20), ses polices et ses fonds (assets/).
 *
 * Droits par module : l'éditeur, les MJ (de la campagne) et les administrateurs. Les API d'Eraser
 * les vérifient de toute façon.
 */
import { useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { LoaderCircle, ScrollText } from "lucide-react"

import { PageLabel } from "@/components/eraser/app-shell"
import type { CampaignDocumentRecord, DocumentRecipient } from "@/lib/document-model"

import { DocumentStudio, type BackgroundLibrary } from "./document-studio"

/** Ce qu'Eraser donne à l'extension (components/eraser/extension-host.tsx, API 2). */
type EraserContext = {
  api: number
  account: { uid: string; displayName: string; role: "joueur" | "mj" | "admin" }
  path: string[]
  eraser: (path: string, init?: RequestInit) => Promise<Response>
}

type StudioData = {
  campaign: { id: string; name: string }
  documents: CampaignDocumentRecord[]
  sessions: Array<{ id: string; name: string }>
  /** À qui donner un document : les joueurs, puis (Eraser alpha 292 et plus) les marchands (les magasins, pour l'y vendre) et les PNJ. */
  players: DocumentRecipient[]
  merchants?: DocumentRecipient[]
  npcs?: DocumentRecipient[]
  /** Les modèles du compte, dans toutes ses campagnes (Eraser alpha 285 et plus). */
  templates?: CampaignDocumentRecord[]
  /** La bibliothèque des fonds et les mots-clés des fonds fournis (Eraser alpha 292 et plus). */
  library?: BackgroundLibrary
  /** Ce que le serveur sait garder : `dossiers`, `modeles`, `calques`, `pages`… (absent avant l'alpha 285). */
  features?: string[]
}

export function Page({ eraser }: { eraser: EraserContext }) {
  const [screen, campaignId] = eraser.path
  if (eraser.account.role === "joueur") return <Notice title="Réservé" text="L’éditeur des documents est réservé aux MJ et aux administrateurs. Les documents donnés s’ouvrent depuis l’inventaire." />
  if (screen === "campagne" && campaignId) return <CampaignDocuments key={campaignId} eraser={eraser} campaignId={campaignId} />
  return <Notice title="Documents" text="Les documents s’écrivent campagne par campagne : menu › Dossier d’une campagne › Document." />
}

/** Les documents d'une campagne et leur éditeur (l'ancienne page Document). */
function CampaignDocuments({ eraser, campaignId }: { eraser: EraserContext; campaignId: string }) {
  // Lus une fois, comme l'ancienne page : l'éditeur réécrit lui-même l'adresse en ouvrant un document.
  const parameters = useSearchParams()
  const [initial] = useState(() => ({ documentId: parameters.get("document") || "", sessionId: parameters.get("session") || "", startNew: parameters.get("nouveau") === "1" }))
  return <Screen<StudioData> eraser={eraser} url={`/api/campaigns/${encodeURIComponent(campaignId)}/documents?atelier=1`}>
    {(data) => <PageLabel label={`${data.campaign.name} / Document`}>
      <div className="w-full flex-1 px-5 py-9 sm:px-8 md:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/75">{data.campaign.name}</p>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Document</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Lettres, parchemins, pages de grimoire : écris-les sur un ou plusieurs fonds, page après page, donne-les aux joueurs ou aux PNJ, mets-les en vente chez un marchand, montre-les dans le journal de la session (ils les lisent page par page) et envoie-les dans Roll20 avec le compagnon (handout et PDF).</p>
        <DocumentStudio
          campaignId={data.campaign.id}
          initialDocuments={data.documents}
          initialTemplates={data.templates ?? []}
          features={data.features ?? []}
          sessions={data.sessions}
          players={data.players}
          merchants={data.merchants ?? []}
          npcs={data.npcs ?? []}
          library={data.library ?? null}
          initialDocumentId={initial.documentId}
          initialSessionId={initial.sessionId}
          startNew={initial.startNew}
        />
      </div>
    </PageLabel>}
  </Screen>
}

/** Un écran : ses données lues sur Eraser, puis affichées ; `aria-busy` tant qu'il charge (relevé de fluidité). */
function Screen<T>({ eraser, url, children }: { eraser: EraserContext; url: string; children: (data: T) => ReactNode }) {
  const [state, setState] = useState<{ data: T } | { error: string } | null>(null)
  useEffect(() => {
    let alive = true
    eraser.eraser(url)
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as T & { error?: string }
        if (!alive) return
        setState(response.ok ? { data: body } : { error: response.status === 403 ? "Cette campagne n’est pas l’une des tiennes : seuls son MJ et les administrateurs écrivent ses documents." : body.error || "Les documents n’ont pas pu être lus." })
      })
      .catch(() => { if (alive) setState({ error: "Eraser ne répond pas : réessaie dans un instant." }) })
    return () => { alive = false }
  }, [eraser, url])
  if (!state) return <div aria-busy="true" className="grid min-h-[40svh] place-items-center text-muted-foreground"><LoaderCircle className="size-5 animate-spin" aria-label="Chargement des documents…" /></div>
  if ("error" in state) return <Notice title="Document" text={state.error} />
  return <>{children(state.data)}</>
}

function Notice({ title, text }: { title: string; text: string }) {
  return <div className="w-full flex-1 px-5 py-9 sm:px-8 md:py-14">
    <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed bg-card/35 p-8 text-center">
      <div className="max-w-lg">
        <ScrollText className="mx-auto size-9 text-primary/45" />
        <h1 className="font-display mt-3 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  </div>
}
