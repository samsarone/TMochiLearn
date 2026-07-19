# tMochi

A fast, futuristic viewer for Samsar interactive films. tMochi reads the public
`InteractivePublication` catalog, renders publication thumbnails, and plays the
compact `interactive_video_manifest.v1` graph as a seamless branched timeline.

## Features

- Public catalog feed with cursor pagination and search
- Responsive featured and grid views
- Media-timed choice overlays with path thumbnails and branch hints
- Frame-adjacent path switching that preserves volume, mute state, and speed
- Multi-level choice-point support
- A Samsar-authenticated Creator Studio at `/creator`
- Resumable creator sessions at `/creator/[sessionId]`
- One-to-three-level interactive generation with live credit estimates
- Detailed branch previews, downloadable ZIP artifacts, and feed publishing
- A prototype reel when the live catalog has no published films

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm run build
npm test
```

The Samsar API defaults to `https://api.samsar.one/v1`. Override it for local
development with `SAMSAR_API_BASE_URL`. Creator requests authenticate with the
logged-in user's shared `authToken` Bearer credential; they do not require a
Samsar API key. Add any additional exact artifact CDN hostnames as a
comma-separated `SAMSAR_ARTIFACT_HOSTS` value.

Creator login and registration call the Samsar `/users/login` and
`/users/register` endpoints directly through same-origin Next.js routes; the SDK
is not used to collect credentials. A successful response caches `authToken` in
the tMochi origin's localStorage and writes the same 30-day, JavaScript-readable
cookie used by the other Samsar apps. On `*.samsar.one`, that cookie is scoped to
`.samsar.one`, so an existing Samsar, Gallery, or landing-site login is available
to tMochi automatically. localStorage remains origin-scoped and acts only as a
local fallback/cache.
