# DingerLab v1.2.0 — HR Engine integration

Replace the included files in your previous DingerLab app.

## Added
- `hr_data.js` — compact embedded ML model + digital profiles trained on synthetic data.
- `hr_engine.js` — MLB Home Run Prediction Engine UI overlay.
- `tools/inline-hr.js` — idempotent build helper that inlines HR scripts into `index.html`.

## Updated
- `index.html` now includes the HR Engine data + overlay and is stamped `v1.2.0`.
- `README.md` documents the feature.
- `DingerLab Redesign.dc.html` version badge updated to `v1.2.0`.
- `soccer.js` included to preserve the existing soccer module baseline.

## Validation
- JS syntax passed.
- Browser smoke passed: HR launcher appears in MLB mode and opens the Home Run Predictions board + Model Card.
