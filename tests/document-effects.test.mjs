import assert from "node:assert/strict";
import test, { after } from "node:test";

import { loadEraser, loadOwn, vite } from "./eraser.mjs";

// Le relief et le métal des zones de texte, la couverture et l'image de fin, les fonds de la
// bibliothèque : ce que l'éditeur fabrique passe le nettoyage d'Eraser tel quel, et la lumière et les
// ombres d'un relief sont du bon côté.
after(async () => { await vite.close(); });
const model = await loadEraser("/lib/document-model.ts");
const elements = await loadOwn("src/document-elements.ts");
const assets = await loadOwn("src/document-assets.ts");

test("un relief sortant éclairé d'en haut à gauche : la lumière en haut à gauche, les ombres en bas à droite", () => {
  const raised = elements.reliefShadows({ relief: "raised", reliefLight: 315, reliefDepth: 4, reliefSoftness: 1, reliefContrast: 0.6 });
  assert.equal(raised.length, 3);
  const [light, shade, cast] = raised;
  assert.equal(light.color, "#ffffff");
  assert.ok(light.x < 0 && light.y < 0, "la lumière du côté d'où elle vient");
  assert.ok(shade.x > 0 && shade.y > 0 && shade.color === "#000000");
  assert.ok(cast.x > shade.x && cast.blur > shade.blur && cast.alpha < shade.alpha, "l'ombre portée, plus loin et plus douce");
  // Gravé : l'inverse (le bord du côté de la lumière est dans l'ombre).
  const engraved = elements.reliefShadows({ relief: "engraved", reliefLight: 315, reliefDepth: 4, reliefSoftness: 1, reliefContrast: 0.6 });
  assert.deepEqual(engraved.map((shadow) => [Math.sign(shadow.x), shadow.color]), [[1, "#ffffff"], [-1, "#000000"]]);
  // Une lumière venue de droite éclaire le bord droit.
  const right = elements.reliefShadows({ relief: "raised", reliefLight: 90, reliefDepth: 4 });
  assert.ok(right[0].x > 0 && Math.abs(right[0].y) < 0.01);
  assert.deepEqual(elements.reliefShadows({}), []);
  assert.match(elements.reliefShadowCss(raised), /^-1(\.\d+)?px -1(\.\d+)?px 1px rgba\(255, 255, 255, 0\.6\), /);
});

test("chaque relief et chaque métal proposé est une clé qu'Eraser garde", () => {
  assert.deepEqual(elements.reliefKinds.map((kind) => kind.value).filter((value) => value !== "none").sort(), [...model.documentReliefs].sort());
  assert.deepEqual(elements.metals.map((metal) => metal.value).sort(), [...model.documentMetals].sort());
  for (const metal of elements.metals) {
    assert.match(elements.metalGradientCss(metal.value), /^linear-gradient\(180deg, #[0-9a-f]{6} 0%, .* 100%\)$/);
    assert.equal(metal.stops[0][0], 0);
    assert.equal(metal.stops.at(-1)[0], 1);
  }
  assert.equal(elements.metalGradientCss(undefined), "");
});

test("un titre en or en relief sur une couverture passe le nettoyage d'Eraser sans rien perdre", () => {
  const title = assets.newDocumentZone({ font: "cinzel", size: 76, align: "center", paragraphs: assets.plainParagraphs("Le Grimoire"), metal: "gold", blend: "normal", ink: false, ...elements.defaultRelief({ size: 76 }, "raised") });
  assert.deepEqual([title.relief, title.metal, title.reliefLight], ["raised", "gold", 315]);
  const cover = { version: 1, height: 1000, zones: [title], lines: [], shapes: [], pictures: [], order: [title.id], role: "cover" };
  assert.deepEqual(model.cleanDocumentContent(JSON.parse(JSON.stringify(cover))), cover);
  const end = { version: 1, height: 1000, zones: [], lines: [], shapes: [], pictures: [], order: [], role: "end" };
  assert.deepEqual(model.cleanDocumentContent(end), end);
  // Une couverture dupliquée est une page ordinaire.
  assert.equal("role" in elements.copiedContent(cover).content, false);
});

test("un fond de la bibliothèque : son adresse, et Eraser le garde à l'enregistrement", () => {
  assert.equal(assets.libraryBackgroundUrl("fond-1"), model.documentLibraryImageUrl("fond-1"));
  assert.deepEqual(model.cleanDocumentBackground({ kind: "library", id: "fond-1" }), { kind: "library", id: "fond-1" });
  assert.equal(assets.keywordKey(assets.COVER_KEYWORD), model.keywordKey(model.COVER_KEYWORD));
  assert.equal(assets.keywordKey(assets.END_KEYWORD), model.keywordKey(model.END_KEYWORD));
  assert.equal(assets.keywordKey(" COUVERTURE "), assets.keywordKey("Couverture"));
});
