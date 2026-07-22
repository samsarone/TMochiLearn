<p align="center">
  <img src="public/tmochi-learn-logo.png" alt="TMochiLearn" width="96" />
</p>

<p align="center"><strong>Interactive educational videos that adapt to every choice.</strong></p>

<p align="center">
  <a href="https://github.com/samsarone/TmochiLearn/actions/workflows/ci.yml"><img src="https://github.com/samsarone/TmochiLearn/actions/workflows/ci.yml/badge.svg" alt="Tests" /></a>
</p>

TMochiLearn turns a single topic into an interactive lesson with choices,
alternate explanations, and outcomes shaped by the learner. Describe what you
want to teach, choose how deeply it should branch, and generate a complete
learning-path tree.

Every path belongs to one connected learning experience. Learners can explore
different approaches, see the consequences of each choice, and build a deeper
understanding of educational and technical subjects.

Built with [Codex](https://openai.com/codex/) using GPT 5.6 Sol in High and Ultra
settings, with manual QA, verification, and code debugging.<br />
Submission for the [OpenAI Devpost hackathon](https://openai.devpost.com/).

## Don’t just watch. Explore.

A TMochiLearn lesson presents clear, focused video segments and lets the learner
choose what to examine next.

- A subtle **Choose the next path** cue appears before each decision.
- Learning-path previews transition naturally from the current topic.
- Every choice continues from the same moment without losing sound or playback
  settings.
- Multi-level lessons remember the path already taken.
- Shared lesson links open directly in the interactive player.
- The public learning library makes published lessons easy to discover and replay.

## One topic. Every learning path.

The Creator Studio is designed for educators, trainers, and technical creators.

1. **Describe your lesson** — start with a concept, process, skill, or scenario
   learners should understand.
2. **Choose the depth** — create a focused fork or a learning tree with up to three
   levels of decisions.
3. **Build the lesson** — follow live generation progress and see the learning-path
   map fill with scenes.
4. **Preview every route** — explore random paths or review the lesson choice by
   choice.
5. **Describe the lesson** — write the public details yourself or let TMochiLearn
   generate a title and description.
6. **Publish the experience** — release it to the TMochiLearn learning library or
   download the complete artifact package.

## Made for interactive learning

- **Prompt-to-interactive-lesson creation** powered by Samsar
- **One-to-three-level learning trees** with distinct branches and outcomes
- **Live branch topology** that shows the structure as it is created
- **Resumable sessions** so a lesson remains available at its own Creator URL
- **Interactive previews** with media-accurate decision points
- **Smart publishing metadata** generated from the completed lesson
- **Transparent credit estimates and balances** throughout creation
- **Downloadable production artifacts** for every rendered path
- **A public learning library** with search, featured lessons, and shareable
  watch links

## Learning with more than one path

TMochiLearn is built around a simple belief: learners understand more when they
actively explore. They can test an assumption, compare an approach, troubleshoot
a system, or revisit a concept—and the lesson should respond to every decision.

The result is an adaptive format for educational and technical content: structured
enough to teach intentionally and flexible enough to support curiosity.

## Powered by Samsar

TMochiLearn uses Samsar to create, render, resume, and publish branching lessons.
Existing Samsar accounts work in the Creator Studio, and completed interactive
publications flow into the same public catalog used by learners.

## For contributors

The project requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Run the same checks shown by the badge:

```bash
npm run lint
npm test
```

`npm test` builds the Cloudflare Worker version and runs the existing Node.js
integration suite against the rendered learning experience, shared player routes,
Creator authentication, branching contracts, generation flow, and publishing
tools.

<details>
<summary>Configuration and deployment notes</summary>

The Samsar API defaults to `https://api.samsar.one/v1`. Set
`SAMSAR_API_BASE_URL` to use another API origin. Creator requests use the
signed-in user’s shared Samsar bearer session. Creator image and video options
are loaded server-side from the public `/video/supported_models` Express model
catalog and submissions are revalidated against that catalog. Additional
artifact hosts can be provided with the comma-separated `SAMSAR_ARTIFACT_HOSTS`
value.

To preview the local UI against the live production publication catalog, run:

```bash
npm run dev:production-catalog
```

This only reads the public production catalog for learners. Creator actions
still require a signed-in Samsar session.

For Vercel, use the Next.js framework preset and the standard `npm run build`
output. The optional Cloudflare Worker workflow is available through
`npm run dev:worker`, `npm run build:worker`, and `npm run start:worker`.

</details>

<h2 align="center">Demo</h2>

<p align="center">
  <a href="https://www.youtube.com/watch?v=uZgqEkFwF6I" target="_blank" rel="noopener noreferrer"><img src="https://img.youtube.com/vi/uZgqEkFwF6I/hqdefault.jpg" alt="Play the TMochiLearn app demo" width="640" /></a>
</p>

<p align="center"><em>App demo screencast created with Codex using GPT 5.6 Ultra settings.</em></p>
