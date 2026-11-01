# Binder-page test photos

Real 9-pocket binder pages photographed with the phones' camera apps (not the
app), used to calibrate the grid fitter (`src/scanner/grid.ts`) and to
benchmark per-pocket OCR. Same page, same nine Pokémon cards, both shot
straight on under room light with the page filling most of the frame.

| file | device | pixels | notes |
|---|---|---|---|
| `fold8-9pocket.jpg` | Galaxy Z Fold 8 | 3000×4000 (EXIF-rotated) | binder rings at the left edge |
| `pixel11-9pocket.jpg` | Pixel 11 Pro XL | 6128×8160 | 50 MP; pockets come out ~1,800 px wide |

Expected cards, row-major: Wartortle PGO 016/078 · Blastoise ex MEW 200/165 ·
Blastoise PGO 017/078 · Caterpie MEW 010/165 · Caterpie EVO 3/108 · Metapod
EVO 4/108 · Butterfree JTG 003/159 · Weedle MEW 013/165 · Weedle XY 3/146.

Grid-fit results when these were added (320 px sample, `fitGridOnSource`):
both boxes within a pocket gap of the cards, confidence 0.59 (Fold) and 0.62
(Pixel), 10–15 ms per fit. Run them through the Vite dev server:
`/@fs/D:/Projects/CardCodex/scripts/fixtures/binder-pages/<file>` (see
`src/scanner/README.md`, "Binder pages").

The desk around the page is left in on purpose (clutter is part of the test);
the paper at the top edge is a statement with its last four digits visible.
