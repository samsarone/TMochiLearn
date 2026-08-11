<p align="center">
  <img src="public/tmochi-learn-logo.png" alt="TMochiLearn" width="96" />
</p>

<h1 align="center">TMochiLearn</h1>

<p align="center"><strong>Create a complete interactive educational video from one lesson brief.</strong></p>

<p align="center">
  <a href="https://github.com/samsarone/TmochiLearn/actions/workflows/ci.yml"><img src="https://github.com/samsarone/TmochiLearn/actions/workflows/ci.yml/badge.svg" alt="Tests" /></a>
</p>

TMochiLearn is a one-shot creator for educational, technical, and training
content. A creator supplies one lesson brief, selects the generation models and
choice depth, and TMochiLearn builds the narrative, every learning path, the rendered
media, and an interactive player in one workflow.

Learners watch a continuous lesson and choose what to explore at each decision
point. A lesson can contain one to three binary choice levels, producing two,
four, or eight complete learning paths.

<p align="center">
  <a href="https://www.youtube.com/watch?v=uZgqEkFwF6I"><strong>Watch the app demo</strong></a>
</p>

## What one generation creates

- A lesson narrative expanded into a complete binary learning tree
- A deduplicated catalog of shared and path-specific scene layers
- Rendered video, narration, music, and supporting audio for every route
- A live learning-path map with scene and full-path previews
- A resumable Creator Studio session at `/creator/[sessionId]`
- A downloadable ZIP containing the interactive manifest and generated artifacts
- An interactive publication that can be shared at `/watch/[publicationId]`

Published lessons appear in the public learning library at `/learn`.

## Creator workflow

1. Sign in or register with a Samsar account. TMochiLearn creates a non-billable
   draft session immediately.
2. Enter a lesson brief of up to 4,000 characters and choose a target duration
   from 30 to 180 seconds.
3. Select the inference, image, and motion models, then choose one to three
   levels of learner decisions.
4. Submit once. The app creates the lesson narrative, generates every route, and
   renders the unique media layers.
5. Follow live progress, inspect the learning-path tree, and preview individual
   scenes or complete routes.
6. Download the artifact package or add publication details and publish the
   finished lesson.

The default form uses a 30-second lesson and two choice levels, which creates
four final paths. TMochiLearn uses a 16:9 interactive-video layout.

## Interactive generation model matrix

TMochiLearn does not use the account-level default model list. It loads the
current Express catalog from `GET /video/supported_models` and only displays
models advertised as compatible with interactive generation. The generation
route fetches the catalog again and validates every selection before submitting
the request.

| Stage | Model | Request value |
| --- | --- | --- |
| Inference | `gpt-5.6-sol` | `gpt-5.6-sol` with `effort: high` (default) or `effort: xhigh` |
| Image | GPT Image 2 | `GPTIMAGE2` |
| Image | Nano Banana Pro | `NANOBANANAPRO` |
| Video | Nvidia Cosmos 3 | `COSMOS3SUPERI2V` |
| Video | Veo 3.1 | `VEO3.1I2V` |
| Video | Veo 3.1 Fast | `VEO3.1I2VFAST` |
| Video | Seedance 2.0 | `SEEDANCE2.0I2V` |

TMochiLearn always submits the selected inference model explicitly and ignores
the user's account default. For direct API clients, omitting the inference model
from the unified interactive request uses `gpt-5.6-sol` with `effort: high`.
Use `effort: xhigh` for deeper technical analysis; legacy suffixed Sol model
keys remain compatible.

The table is the supported matrix, not a guarantee that every model is available
in every deployment. The runtime catalog is the source of truth.

## Render pricing

Production render credits use one rule:

```text
render credits = total unique rendered layer-seconds × video model rate
```

| Video model | Rate |
| --- | ---: |
| Nvidia Cosmos 3 | 20 credits/second |
| Veo 3.1 | 60 credits/second |
| Veo 3.1 Fast | 36 credits/second |
| Seedance 2.0 | 40 credits/second |

The total includes every distinct scene layer created for the interactive
lesson. Shared scenes count once, and each choice-specific scene counts once.
The selected rate covers the complete render pipeline; inference and image
model selections do not add separate render charges.

For example, 150 unique rendered layer-seconds with Nvidia Cosmos 3 costs
`150 × 20 = 3,000 credits`.

Before generation, TMochiLearn may show a conservative maximum because it does
not yet know which scenes will be shared. The final charge uses the actual unique
rendered duration and can be lower. Pipeline stages are settled individually,
so fractional seconds may produce a small rounding difference. Only completed
stages are charged, which can reduce the final charge if rendering stops early.

## Production and standalone deployments

| Behavior | Production | Standalone |
| --- | --- | --- |
| Model catalog | Full supported interactive catalog | Only interactive-compatible models available through configured providers |
| Samsar credit admission | Requires an available credit balance | Bypassed |
| Generation credit settlement | Stages debit Samsar credits | Zero Samsar credits; stage receipts are waived |
| Provider cost | Covered by the Samsar credit rate | Paid directly by the deployment operator under each provider's pricing |
| Creator availability | Requires at least one model for every pipeline stage | Same requirement; fails closed when a stage has no configured model |

In standalone, provider credentials and adapters belong to the Samsar processor,
not this frontend. TMochiLearn disables submission unless the runtime catalog
contains at least one compatible inference model, one compatible image model,
and one compatible video model. The production credit rates above are not standalone
provider-price quotes. If the Creator displays the production comparison
estimate in standalone, that number is informational and is not deducted.

## Run locally

Requirements:

- Node.js `>=22.13.0`
- npm
- A reachable Samsar API deployment
- A Samsar account/session for Creator Studio

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000`. The default configuration connects to the public
Samsar production API.

### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SAMSAR_API_BASE_URL` | No | `https://api.samsar.one/v1` | Samsar API base URL, including the `/v1` path |
| `SAMSAR_ARTIFACT_HOSTS` | No | Empty | Comma-separated HTTPS hostnames added to the artifact-download proxy allowlist |

Provider API keys are configured on the Samsar processor deployment and must not
be added to the TMochiLearn frontend environment.

### Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run dev:production-catalog` | Run locally against the public production catalog |
| `npm run build` | Create the Next.js production build |
| `npm start` | Serve the Next.js production build |
| `npm run lint` | Run ESLint |
| `npm test` | Build the Cloudflare Worker target and run the Node integration suite |
| `npm run dev:worker` | Start the local vinext/Cloudflare Worker target |
| `npm run build:worker` | Build the Cloudflare Worker target |

## Deployment

The Next.js build uses standalone output and includes server rendering, route
handlers, authentication, and request-derived social metadata. Vercel can use
the Next.js framework preset with `npm run build`.

Build and run the production container with:

```bash
docker build -t tmochi-learn:latest .
docker run --rm -p 3001:3000 \
  -e SAMSAR_API_BASE_URL=https://api.samsar.one/v1 \
  tmochi-learn:latest
```

The container runs as an unprivileged user, listens on port `3000`, and exposes
`GET /api/health`. When deploying behind nginx, use `nginx.conf.example` and
forward `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` so canonical and
social URLs are generated correctly.

Cloudflare Worker builds are available through `npm run build:worker` and
`npm run start:worker`.

## License

TMochiLearn is available under the [MIT License](LICENSE).
