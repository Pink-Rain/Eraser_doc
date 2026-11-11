import assert from "node:assert/strict";
import test, { after } from "node:test";

import { loadEraser, loadOwn, vite } from "./eraser.mjs";

// Les pages d'un document : ce que l'éditeur fabrique (une page dupliquée, la suite d'une page) passe
// le nettoyage d'Eraser tel quel, chaque élément copié a son propre nom (et chaque calque de dessin
// son propre fichier), et un document de plusieurs pages part avec les fonds de ses pages en premier.
after(async () => { await vite.close(); });
const model = await loadEraser("/lib/document-model.ts");
const elements = await loadOwn("src/document-elements.ts");
const assets = await loadOwn("src/document-assets.ts");
const upload = await loadOwn("src/document-upload.ts");

function richPage() {
  let content = assets.documentFromBuiltin("parchemin");
  const line = elements.newDocumentLine({ style: "dashed" });
  const shape = elements.newDocumentShape({ shape: "star", fill: "radial" });
  content = elements.withElementOnTop(content, { kind: "line", id: line.id, line });
  content = elements.withElementOnTop(content, { kind: "shape", id: shape.id, shape });
  content = elements.withElementOnTop(content, { kind: "picture", id: "dessin", picture: { id: "dessin", kind: "drawing", asset: "trait", x: 0, y: 0, width: 1000, height: 1000, rotation: 0, opacity: 1, blend: "multiply" } });
  content = elements.withElementOnTop(content, { kind: "picture", id: "photo", picture: { id: "photo", kind: "image", asset: "sceau", x: 10, y: 10, width: 100, height: 100, rotation: 0, opacity: 1, blend: "normal" } });
  return content;
}

test("une page dupliquée : tout est recopié sous de nouveaux noms, l'ordre des calques suit", () => {
  const original = richPage();
  const copy = elements.copiedContent(original);
  const ids = (content) => [...content.zones, ...content.lines, ...content.shapes, ...content.pictures].map((element) => element.id);
  // Aucun nom commun avec l'original, et l'ordre des calques désigne les copies dans le même ordre.
  assert.equal(ids(copy.content).filter((id) => ids(original).includes(id)).length, 0);
  assert.deepEqual(copy.content.order, original.order.map((id) => copy.ids.get(id)));
  // Le calque de dessin a son propre fichier ; l'image posée garde le sien.
  const drawing = copy.content.pictures.find((picture) => picture.kind === "drawing");
  const photo = copy.content.pictures.find((picture) => picture.kind === "image");
  assert.notEqual(drawing.asset, "trait");
  assert.deepEqual([...copy.assets], [["trait", drawing.asset]]);
  assert.equal(photo.asset, "sceau");
  // Le texte est le même, mais modifier la copie ne touche pas l'original.
  assert.deepEqual(copy.content.zones.map((zone) => zone.paragraphs), original.zones.map((zone) => zone.paragraphs));
  copy.content.zones[0].paragraphs[0][0].text = "Autre";
  assert.notEqual(original.zones[0].paragraphs[0][0].text, "Autre");
});

test("la suite d'une page : ses zones de texte, vides, au même endroit et dans le même style, rien d'autre", () => {
  const original = richPage();
  const next = elements.continuedContent(original);
  assert.equal(next.height, original.height);
  assert.deepEqual([next.lines, next.shapes, next.pictures], [[], [], []]);
  assert.equal(next.zones.length, original.zones.length);
  next.zones.forEach((zone, index) => {
    const { id, paragraphs, ...style } = zone;
    const { id: originalId, paragraphs: _text, ...originalStyle } = original.zones[index];
    assert.notEqual(id, originalId);
    assert.deepEqual(paragraphs, []);
    assert.deepEqual(style, originalStyle);
  });
  assert.deepEqual(next.order, next.zones.map((zone) => zone.id));
});

test("des pages faites par l'éditeur passent le nettoyage d'Eraser sans rien perdre", () => {
  const first = richPage();
  const pages = [
    { id: crypto.randomUUID(), background: { kind: "builtin", key: "parchemin" }, content: elements.continuedContent(first) },
    { id: crypto.randomUUID(), background: { kind: "upload" }, content: elements.copiedContent(first).content },
    { id: crypto.randomUUID(), background: { kind: "builtin", key: "livre" }, content: assets.documentFromBuiltin("livre") },
    { id: crypto.randomUUID(), background: { kind: "url", url: "https://example.org/carte.png" }, content: assets.documentOnOwnBackground() },
  ];
  assert.deepEqual(model.cleanDocumentPages(JSON.parse(JSON.stringify(pages))), pages);
  // Eraser garde les pièces de toutes les pages avec le document.
  assert.deepEqual(model.documentAssets(first, pages).sort(), ["sceau", "trait", pages[1].content.pictures.find((picture) => picture.kind === "drawing").asset].sort());
});

test("un document de plusieurs pages part avec les fonds de ses pages dans le premier envoi", async () => {
  const json = JSON.stringify({ id: "d1", title: "Grimoire", pages: [{ id: "p2" }, { id: "p3" }] });
  const part = (field, bytes, type = "image/webp") => ({ field, file: new File([new Uint8Array(bytes)], `${field}.bin`, { type }) });
  const parts = [
    part("background", 3_000_000), part("background-p3", 3_000_000), part("piece-trait", 500_000),
    part("render", 900_000), part("print", 900_000, "image/jpeg"),
    ...[2, 3].flatMap((page) => [part(`render-${page}`, 900_000), part(`print-${page}`, 900_000, "image/jpeg")]),
  ];
  const forms = await upload.documentForms(json, parts, upload.LARGE_REQUESTS);
  assert.equal(forms.length, 1);
  assert.deepEqual([...forms[0].keys()].filter((key) => key !== "document"), parts.map((one) => one.field));
  // Trop lourd pour un envoi : les fonds restent ensemble, en tête.
  const heavy = await upload.documentForms(json, [...parts, ...Array.from({ length: 12 }, (_, index) => part(`render-${index + 4}`, 2_000_000))], upload.LARGE_REQUESTS);
  assert.ok(heavy.length > 1);
  assert.ok(heavy[0].has("background") && heavy[0].has("background-p3"));
});
