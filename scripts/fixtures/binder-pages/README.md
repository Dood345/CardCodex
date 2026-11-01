# Binder-page test photos

Real 9-pocket binder pages photographed with the phones' camera apps (not the
app), used to calibrate the grid fitter (`src/scanner/grid.ts`) and to
benchmark per-pocket OCR. Same page, same nine Pokémon cards, both shot
straight on under room light with the page filling most of the frame.

| file | device | pixels | notes |
|---|---|---|---|
| `fold8-9pocket.jpg` | Galaxy Z Fold 8 | 3000×4000 (EXIF-rotated) | binder rings at the left edge |
| `pixel11-9pocket.jpg` | Pixel 11 Pro XL | 6128×8160 | 50 MP; pockets come out ~1,800 px wide |
| `pixel11-9pocket-b.jpg` | Pixel 11 Pro XL | 6128×8160 (EXIF-rotated) | a different page: four card eras (Base Set, DP, Evolutions, SV), the previous page's cards showing at the left edge |

Expected cards, row-major (catalog ids in brackets):

- `fold8-9pocket.jpg` and `pixel11-9pocket.jpg` (same page): Wartortle PGO 016/078
  (`swsh10.5-016`) · Blastoise ex MEW 200/165 (`sv03.5-200`) · Blastoise PGO 017/078
  (`swsh10.5-017`) · Caterpie MEW 010/165 (`sv03.5-010`) · Caterpie EVO 3/108 (`xy12-3`) ·
  Metapod EVO 4/108 (`xy12-4`) · Butterfree JTG 003/159 (`sv09-003`) · Weedle MEW 013/165
  (`sv03.5-013`) · Weedle XY 3/146 (`xy1-3`).
- `pixel11-9pocket-b.jpg`: Nidorina MT 56/123 (`dp2-56`) · Nidoqueen MT 31/123 (`dp2-31`) ·
  Nidoqueen MEW 031/165 (`sv03.5-031`) · Nidoran EVO 43/108 (`xy12-43`) · Nidoran♂ SW 97/132
  (`dp3-97`) · Nidoran♂ Base Set 55/102 (`base1-55`) · Nidorino EVO 44/108 (`xy12-44`) ·
  Nidoking Base Set 2 11/130 (`base4-11`) · Clefairy FFI 70/111 (`xy3-70`).

Grid-fit results when these were added (320 px sample, `fitGridOnSource`):
both boxes within a pocket gap of the cards, confidence 0.59 (Fold) and 0.62
(Pixel), 10–15 ms per fit. Run them through the Vite dev server:
`/@fs/D:/Projects/CardCodex/scripts/fixtures/binder-pages/<file>` (see
`src/scanner/README.md`, "Binder pages").

The desk around the page is left in on purpose (clutter is part of the test);
the paper at the top edge is a statement with its last four digits visible.
