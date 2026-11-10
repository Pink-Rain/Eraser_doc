import assert from "node:assert/strict";
import test, { after } from "node:test";

import { loadOwn, vite } from "./eraser.mjs";

// L'envoi d'un document (src/document-upload.ts) : le serveur d'Eraser (vinext) refuse tout envoi
// de fichiers de plus de 1 Mo (413), même vers /api/… ; le document part donc en plusieurs envois.
after(async () => { await vite.close(); });
const upload = await loadOwn("src/document-upload.ts");

const LIMIT = 1024 * 1024;
const json = JSON.stringify({ id: "d1", title: "Lettre", sessionId: "", background: { kind: "upload" }, content: { version: 1, height: 1000, zones: [] } });
const part = (field, bytes, type = "image/webp") => ({ field, file: new File([new Uint8Array(bytes)], `${field}.bin`, { type }) });
const size = async (form) => (await new Response(form).blob()).size;
const fields = (form) => ["background", "render", "print"].filter((field) => form.has(field));

test("un rendu et une impression trop lourds ensemble partent en deux envois, chacun sous 1 Mo", async () => {
  const forms = await upload.documentForms(json, [part("render", 700_000), part("print", 970_000, "image/jpeg")]);
  assert.deepEqual(forms.map(fields), [["render"], ["print"]]);
  for (const form of forms) {
    assert.ok(await size(form) <= LIMIT);
    assert.equal(form.get("document"), json);
  }
});

test("des images légères partent ensemble, et le fond importé toujours en premier", async () => {
  const light = await upload.documentForms(json, [part("render", 300_000), part("print", 400_000, "image/jpeg")]);
  assert.deepEqual(light.map(fields), [["render", "print"]]);
  const withBackground = await upload.documentForms(json, [part("background", 900_000), part("render", 500_000), part("print", 400_000, "image/jpeg")]);
  assert.deepEqual(withBackground.map(fields), [["background"], ["render", "print"]]);
  for (const form of withBackground) assert.ok(await size(form) <= LIMIT);
});

test("chaque image est préparée pour tenir dans un envoi, document compris", () => {
  const budget = upload.partBudget(json);
  assert.ok(budget > 900_000 && budget + new Blob([json]).size < LIMIT);
  assert.ok(upload.partBudget(json + "x".repeat(48_000)) < budget - 47_000);
});

test("avec un Eraser qui l'accepte, tout le document part en un seul envoi, images en pleine qualité", async () => {
  const parts = [part("background", 900_000), part("piece-sceau", 300_000), part("render", 700_000), part("print", 970_000, "image/jpeg")];
  const forms = await upload.documentForms(json, parts, upload.LARGE_REQUESTS);
  assert.deepEqual(forms.map(fields), [["background", "render", "print"]]);
  assert.ok(forms[0].has("piece-sceau"));
  // Une image n'est pas allégée pour tenir dans 1 Mo, mais ne dépasse jamais ce qu'Eraser accepte.
  const budget = upload.partBudget(json, upload.LARGE_REQUESTS);
  assert.ok(budget > 10_000_000 && budget < 15 * 1024 * 1024);
});
