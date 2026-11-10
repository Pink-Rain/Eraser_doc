import assert from "node:assert/strict";
import test, { after } from "node:test";

import { loadEraser, loadOwn, vite } from "./eraser.mjs";

// Les éléments de l'éditeur (src/document-elements.ts) : ce que l'éditeur crée passe le nettoyage
// d'Eraser tel quel (sinon un réglage serait perdu à l'enregistrement), et l'ordre des calques tient.
after(async () => { await vite.close(); });
const model = await loadEraser("/lib/document-model.ts");
const elements = await loadOwn("src/document-elements.ts");

test("une ligne, une forme, une image et un calque de dessin neufs passent le nettoyage d'Eraser sans rien perdre", () => {
  const line = elements.newDocumentLine({ style: "dotted", blend: "screen" });
  const shapes = elements.shapeKinds.map((kind) => elements.newDocumentShape({ shape: kind.value, fill: "linear", fillOpacity2: 0, gradientAngle: 45, radius: 12 }));
  const picture = { id: "p1", kind: "drawing", asset: "dessin-1", x: 0, y: 0, width: 1000, height: 1000, rotation: 0, opacity: 1, blend: "soft-light" };
  let content = { version: 1, height: 1000, zones: [], lines: [], shapes: [], pictures: [], order: [] };
  content = elements.withElementOnTop(content, { kind: "line", id: line.id, line });
  for (const shape of shapes) content = elements.withElementOnTop(content, { kind: "shape", id: shape.id, shape });
  content = elements.withElementOnTop(content, { kind: "picture", id: picture.id, picture });
  assert.deepEqual(model.cleanDocumentContent(content), content);
  // Chaque mode de fusion proposé est une clé qu'Eraser garde.
  assert.deepEqual(elements.blendModes.map((mode) => mode.value).sort(), [...model.documentBlendModes].sort());
  assert.deepEqual(elements.shapeKinds.map((kind) => kind.value).sort(), [...model.documentShapeKinds].sort());
});

test("l'ordre des calques : monter, descendre, retirer ; un contenu d'avant est complété", () => {
  const old = elements.normalizeContent({ version: 1, height: 1000, zones: [{ id: "a" }, { id: "b" }] });
  assert.deepEqual([old.lines, old.shapes, old.pictures, old.order], [[], [], [], ["a", "b"]]);
  const line = elements.newDocumentLine();
  let content = elements.withElementOnTop(old, { kind: "line", id: line.id, line });
  assert.deepEqual(elements.orderedElements(content).map((element) => element.id), ["a", "b", line.id]);
  content = elements.movedInOrder(content, line.id, "bottom");
  assert.deepEqual(content.order, [line.id, "a", "b"]);
  content = elements.movedInOrder(content, line.id, 1);
  assert.deepEqual(content.order, ["a", line.id, "b"]);
  content = elements.withoutElement(content, line.id);
  assert.deepEqual([content.lines.length, content.order], [0, ["a", "b"]]);
});

test("formes et dégradés : des chemins SVG fermés, un dégradé qui traverse la boîte", () => {
  for (const kind of elements.shapeKinds) {
    const path = elements.shapePath({ shape: kind.value, width: 200, height: 100, radius: 20 });
    assert.match(path, /^M[\d. ]+.*Z$/, kind.value);
  }
  assert.equal(elements.shapePath({ shape: "rectangle", width: 200, height: 100, radius: 0 }), "M0 0H200V100H0Z");
  const across = elements.shapeGradient({ fill: "linear", width: 200, height: 100, gradientAngle: 0 });
  assert.deepEqual([across.x1, across.x2, across.y1, across.y2].map((value) => Math.round(value) + 0), [0, 200, 50, 50]);
  const down = elements.shapeGradient({ fill: "linear", width: 200, height: 100, gradientAngle: 90 });
  assert.deepEqual([down.x1, down.x2, down.y1, down.y2].map((value) => Math.round(value) + 0), [100, 100, 0, 100]);
  assert.equal(elements.withAlpha("#ff8000", 0.5), "rgba(255, 128, 0, 0.5)");
});

test("un point du document dans un calque incliné et agrandi", () => {
  const layer = { x: 100, y: 100, width: 200, height: 100, rotation: 90 };
  // Le centre du calque reste son centre ; son pixel (0,0) est en haut à droite une fois tourné.
  assert.deepEqual(elements.documentToPicture(layer, { width: 400, height: 200 }, { x: 200, y: 150 }), { x: 200, y: 100 });
  const corner = elements.documentToPicture(layer, { width: 400, height: 200 }, { x: 250, y: 50 });
  assert.deepEqual([Math.round(corner.x) + 0, Math.round(corner.y) + 0], [0, 0]);
});
