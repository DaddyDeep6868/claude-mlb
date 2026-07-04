# DingerLab build tools

Small helper scripts for maintaining the packaged app. Run them from the
project root (the folder that contains `index.html`).

## Killing `[bundle] error` for good

The app renders with React, which is loaded at runtime. There are three layers
of protection against the old `[bundle] error` screen:

1. **Multi-CDN fallback** - if unpkg is down, it retries jsDelivr.
2. **Offline self-cache** - the first time the app loads with internet, React
   and ReactDOM are cached in the browser's `localStorage`. Every load after
   that works with no network, even fully offline.
3. **Hard-code (strongest)** - bake React + ReactDOM directly into
   `index.html` so booting never touches the network at all, even on a
   first-ever offline open.

### Hard-code React (recommended for a truly self-contained file)

```bash
node tools/inline-react.js
```

- If you have internet, it downloads React 18.3.1 + ReactDOM 18.3.1 and
  inlines them.
- For a fully offline build, first drop the two UMD files into
  `tools/vendor/`:
  - `tools/vendor/react.production.min.js`
  - `tools/vendor/react-dom.production.min.js`
  then run the command above.

The script is idempotent - running it twice does nothing the second time.

## Updating the version

Always bump the version on both the UI badge and the zip filename.

```bash
node tools/set-version.js 1.0.3
```

This updates the on-screen badge in `index.html` and
`DingerLab Redesign.dc.html`, plus the README title. Then re-zip:

```bash
zip -rq ../DingerLab_v1.0.3_StadiumNight.zip .
```
