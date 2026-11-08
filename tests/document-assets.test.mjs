import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";

import { loadEraser, loadOwn, vite } from "./eraser.mjs";

// Les fonds et les polices de l'éditeur (src/document-assets.ts) : chaque clé qu'Eraser accepte a
// son fond ou sa police ici, et un nouveau document sur un fond fourni arrive prêt à remplir.
after(async () => { await vite.close(); });
const model = await loadEraser("/lib/document-model.ts");
const assets = await loadOwn("src/document-assets.ts");

test("les fonds fournis arrivent avec leurs zones prêtes à remplir", () => {
  for (const key of model.builtinBackgroundKeys) {
    const content = assets.documentFromBuiltin(key);
    assert.equal(content.height, 1000);
    assert.ok(content.zones.length >= 2, key);
    assert.ok(content.zones.every((zone) => zone.paragraphs.length && zone.x >= 0 && zone.x + zone.width <= 1000), key);
    // Ce qu'Eraser vérifie à l'enregistrement ne change rien au document neuf.
    assert.deepEqual(model.cleanDocumentContent(content), content, key);
  }
});

test("chaque clé d'Eraser a son fond et sa police, avec leurs fichiers à côté du module", () => {
  assert.deepEqual(Object.keys(assets.builtinBackgrounds).sort(), [...model.builtinBackgroundKeys].sort());
  assert.deepEqual(Object.keys(assets.documentFonts).sort(), [...model.documentFontKeys].sort());
  const shipped = (url) => existsSync(join(import.meta.dirname, "..", "assets", ...new URL(url).pathname.split("/").slice(-2)));
  for (const background of Object.values(assets.builtinBackgrounds)) assert.ok(/\/fonds\/[a-z]+\.webp$/.test(background.src) && shipped(background.src), background.src);
  for (const font of Object.values(assets.documentFonts)) for (const file of font.files) assert.ok(/\/polices\/[a-z-]+-latin-\d{3}-(normal|italic)\.woff2$/.test(file.file) && shipped(file.file), file.file);
});
