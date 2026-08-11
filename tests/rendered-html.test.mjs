import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("filters the Creator catalog to canonical models and preserves legacy Sol effort", async () => {
  const {
    createCreatorModelCatalog,
    inferCreatorInferenceEffort,
    normalizeCreatorInferenceModel,
  } = await import(
    new URL(`../lib/creator-config.ts?test=${Date.now()}`, import.meta.url)
  );
  const catalog = createCreatorModelCatalog({
    INFERENCE_MODELS: [
      { value: "gpt-5.6-sol", label: "Wrong fallback label", isBranchedInferenceModel: true },
      { value: "gpt-5.6-sol-xhigh", isBranchedInferenceModel: true },
      { value: "gemini-3.1-pro", isBranchedInferenceModel: false },
      { value: "unflagged-inference" },
    ],
    IMAGE_MODELS: [
      { value: "GPTIMAGE2", isBranchedImageModel: true },
      { value: "NANOBANANAPRO", isBranchedImageModel: true },
      { value: "SEEDREAM", isBranchedImageModel: false },
      { value: "UNFLAGGED_IMAGE" },
    ],
    VIDEO_MODELS: [
      {
        value: "COSMOS3SUPERI2V",
        isBranchedVideoModel: true,
        pricingDistribution: { total: 20 },
      },
      { value: "VEO3.1I2V", isBranchedVideoModel: true, basePrice: 60 },
      { value: "VEO3.1I2VFAST", isBranchedVideoModel: true, basePrice: 36 },
      { value: "SEEDANCE2.0I2V", isBranchedVideoModel: true, basePrice: 40 },
      { value: "RUNWAYML", isBranchedVideoModel: false },
      { value: "UNFLAGGED_VIDEO" },
    ],
    deployment: { edition: "standalone" },
  });

  assert.equal(catalog.deploymentEdition, "standalone");
  assert.deepEqual(
    catalog.inferenceModels.map(({ value, label }) => ({ value, label })),
    [
      { value: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    ],
  );
  assert.deepEqual(catalog.imageModels.map((model) => model.value), [
    "GPTIMAGE2",
    "NANOBANANAPRO",
  ]);
  assert.deepEqual(catalog.videoModels.map((model) => model.value), [
    "COSMOS3SUPERI2V",
    "VEO3.1I2V",
    "VEO3.1I2VFAST",
    "SEEDANCE2.0I2V",
  ]);
  assert.deepEqual(
    catalog.videoModels.map((model) => model.creditsPerSecond),
    [20, 60, 36, 40],
  );
  assert.equal(normalizeCreatorInferenceModel("gpt-5.6-sol-high"), "gpt-5.6-sol");
  assert.equal(normalizeCreatorInferenceModel("gpt-5.6-sol-xhigh"), "gpt-5.6-sol");
  assert.equal(inferCreatorInferenceEffort("gpt-5.6-sol-xhigh"), "xhigh");
  assert.equal(inferCreatorInferenceEffort("gpt-5.6-sol-xhigh", "high"), "high");
});

test("preserves empty standalone Creator model lists as valid availability", async () => {
  const { createCreatorModelCatalog } = await import(
    new URL(`../lib/creator-config.ts?empty=${Date.now()}`, import.meta.url)
  );
  const catalog = createCreatorModelCatalog({
    INFERENCE_MODELS: [],
    IMAGE_MODELS: [],
    VIDEO_MODELS: [],
    deployment: { edition: "standalone" },
  });

  assert.equal(catalog.deploymentEdition, "standalone");
  assert.deepEqual(catalog.inferenceModels, []);
  assert.deepEqual(catalog.imageModels, []);
  assert.deepEqual(catalog.videoModels, []);
});

test("submits newly catalogued interactive models through the installed SDK", async () => {
  const [{ default: SamsarClient }, { createCompatibleTextToInteractiveVideo }] = await Promise.all([
    import("samsar-js"),
    import(new URL(`../lib/samsar-client.ts?compat=${Date.now()}`, import.meta.url)),
  ]);
  const calls = [];
  const client = new SamsarClient({
    authToken: "  creator-session-token  ",
    baseUrl: "https://processor.example/v1",
    fetch: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({
        request_id: "507f1f77bcf86cd799439011",
        session_id: "507f1f77bcf86cd799439011",
        status: "PENDING",
        narrative_type: "branched",
      }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const input = {
    prompt: "An adaptive systems lesson",
    duration: 30,
    inference_model: "gpt-5.6-sol",
    effort: "xhigh",
    image_model: "GPTIMAGE2",
    video_model: "SEEDANCE2.0I2V",
    num_levels: 2,
    session_id: "507f1f77bcf86cd799439011",
  };
  const result = await createCompatibleTextToInteractiveVideo(client, input, {
    idempotencyKey: "tmochi-compatible-request",
    webhookUrl: "https://example.com/tmochi-hook",
  });

  assert.equal(result.status, 202);
  assert.equal(result.data.request_id, "507f1f77bcf86cd799439011");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://processor.example/v2/text_to_interactive_video");
  assert.equal(calls[0].init.headers.Authorization, "Bearer creator-session-token");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "tmochi-compatible-request");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    input,
    webhookUrl: "https://example.com/tmochi-hook",
  });
});

test("does not retry API errors through the interactive model compatibility path", async () => {
  const [
    { default: SamsarClient, SamsarRequestError },
    { createCompatibleTextToInteractiveVideo },
  ] = await Promise.all([
    import("samsar-js"),
    import(new URL(`../lib/samsar-client.ts?api-error=${Date.now()}`, import.meta.url)),
  ]);
  let fetchCalls = 0;
  const client = new SamsarClient({
    authToken: "creator-session-token",
    baseUrl: "https://processor.example/v1",
    fetch: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({
        message: "The selected provider is temporarily unavailable.",
        code: "MODEL_UNAVAILABLE",
      }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await assert.rejects(
    () => createCompatibleTextToInteractiveVideo(client, {
      prompt: "An adaptive systems lesson",
      duration: 30,
      inference_model: "gpt-5.6-sol",
      effort: "xhigh",
      image_model: "GPTIMAGE2",
      video_model: "SEEDANCE2.0I2V",
      num_levels: 2,
    }),
    (error) => (
      error instanceof SamsarRequestError &&
      error.status === 422 &&
      error.body?.code === "MODEL_UNAVAILABLE"
    ),
  );
  assert.equal(fetchCalls, 1);
});

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost/"), { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the TMochiLearn interactive learning landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TMochiLearn — Interactive Learning<\/title>/i);
  assert.match(html, /Featured interactive video/i);
  assert.doesNotMatch(html, /<h2>Explore<\/h2>/i);
  assert.doesNotMatch(html, /Search interactive lessons/i);
  assert.doesNotMatch(html, /Learn every path|Understand deeply/i);
  assert.match(html, /lucide-wand-sparkles/i);
  assert.match(html, />Create<\/button>/i);
  assert.doesNotMatch(html, /<nav[^>]*aria-label="Main navigation"/i);
  assert.doesNotMatch(html, /href="\/learn"[^>]*>Explore<\/a>/i);
  assert.match(html, /brand-cat-mark/i);
  assert.match(html, /tmochi-learn-logo\.png/i);
  assert.match(html, /brand-word[^>]*>TMochiLearn<\/span>/i);
  assert.match(html, /featured-media-skeleton/i);
  assert.match(html, /featured-panel-skeleton/i);
  assert.match(html, /featured-title-skeleton/i);
  assert.match(html, /film-card-skeleton/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders the education-only Learn catalog", async () => {
  const response = await render("/learn");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Choose what you/i);
  assert.match(html, /learn next/i);
  assert.match(html, /Interactive learning library/i);
  assert.match(html, /Educational interactive content/i);
  assert.match(html, /Browse topics/i);
});

test("redirects legacy Explore URLs to Learn", async () => {
  const response = await render("/explore");
  assert.equal(response.status, 308);
  assert.equal(new URL(response.headers.get("location")).pathname, "/learn");
});

test("server-renders shared player URLs in a paused loading state", async () => {
  const response = await render("/watch/shared-publication-id");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Loading interactive lesson/i);
  assert.doesNotMatch(html, /autoPlay/i);
});

test("server-renders a Samsar sign-in gate for the protected Creator Studio", async () => {
  const response = await render("/creator");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Creator Studio/i);
  assert.match(html, /Sign in to build/i);
  assert.match(html, /Continue with Samsar/i);
  assert.match(html, /Sign up/i);
  assert.match(html, /name="email"/i);
  assert.match(html, /name="password"/i);
});

test("keeps session-scoped Creator URLs behind the same sign-in gate", async () => {
  const response = await render("/creator/507f1f77bcf86cd799439011");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Creator Studio/i);
  assert.match(html, /Continue with Samsar/i);
});

test("keeps the viewer wired to the public interactive publication contract", async () => {
  const [page, route, detailRoute, watchPage, styles, layout, favicon, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/interactive-publications/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/interactive-publications/[publicationId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/watch/[publicationId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /InteractivePlayer/);
  assert.match(page, /PublicationBranchTree/);
  assert.match(page, /onClick=\{\(\) => node\.target && onSelectLeaf\(node\.target\)\}/);
  assert.match(page, /onRestart=\{restart\}/);
  assert.match(page, /selectedLeafPathId/);
  assert.match(page, /pauseInactiveVideos/);
  assert.match(page, /nextChoice && !selectedLeafPathIdRef\.current/);
  assert.match(page, /poster-preview-video/);
  assert.match(page, /poster-tree-preview/);
  assert.match(page, /className="site-header watch-header"/);
  assert.match(page, /onClick=\{returnToLandingFromLogo\}/);
  assert.match(page, /featured-title/);
  assert.doesNotMatch(page, /branch-leaf-hover/);
  assert.doesNotMatch(page, /aria-label=\{immersive \? "Return to standard view" : "Close player"\}/);
  assert.match(page, /branch_point_id/);
  assert.match(page, /leaf_path_ids/);
  assert.match(page, /switch_at_seconds/);
  assert.doesNotMatch(page, /Decision point|Left path|Right path/);
  assert.match(page, /handledChoices\.length === 0/);
  assert.match(page, /requestFullscreen/);
  assert.match(page, /is-immersive/);
  assert.match(page, /Return to standard view/);
  assert.match(page, /controls-hidden/);
  assert.match(page, /CHOICE_AUDIO_FADE_LEAD_SECONDS/);
  assert.match(page, /updateChoiceAudioFade/);
  assert.match(page, /restoreChoiceAudioVolume/);
  assert.match(page, /bufferedPaths/);
  assert.match(page, /is-preloading/);
  assert.match(page, /primeBranchFrame/);
  assert.match(page, /MOBILE_PLAYER_MEDIA_QUERY/);
  assert.match(page, /getBufferedInteractiveVideoPaths/);
  assert.match(page, /getMountedInteractiveVideoPaths/);
  assert.match(page, /getInteractiveVideoPreloadMode/);
  assert.match(page, /shouldCacheNextChoiceThumbnails/);
  assert.match(page, /preloadedThumbnailUrlsRef/);
  assert.match(page, /nextChoiceThumbnailUrls/);
  assert.match(page, /image\.decode\(\)/);
  assert.match(page, /loading=\{featured \? "eager" : "lazy"\}/);
  assert.match(page, /publication\.mainVideoUrl \|\| path\.contentUrl/);
  assert.match(page, /playWithSound/);
  assert.match(page, /initialPlaybackRequestedRef/);
  assert.match(page, /fullscreenPlaybackRef/);
  assert.match(page, /!selectedLeafPathId/);
  assert.match(page, /selectedLeafPathIdRef\.current = null/);
  assert.match(page, /initialLeafPathId/);
  assert.match(page, /openPlayerAtPath/);
  assert.match(page, /variant="featured"/);
  assert.match(page, /descriptionExpanded/);
  assert.match(page, /is-idle-playing/);
  assert.match(page, /Learn by <em>choosing\.<\/em>/);
  assert.match(page, /Every alternative outcome, explained\./);
  assert.match(page, /Every path, followed\./);
  assert.match(page, /Every decision builds deeper understanding\./);
  assert.match(page, /addEventListener\("scroll", revealControls/);
  assert.doesNotMatch(page, /Now exploring/);
  assert.doesNotMatch(page, />Play with sound</);
  assert.match(page, /startPaused/);
  assert.match(page, /history\.pushState/);
  assert.match(page, /href=\{publicationPath\(publication\.id\)\}/);
  assert.match(page, /limit: isLearn \? "200" : "30"/);
  assert.match(page, /filtered\.filter\(\(publication\) => publication\.id !== featured\?\.id\)/);
  assert.doesNotMatch(page, /autoPlay=/);
  assert.doesNotMatch(page, /requestAnimationFrame/);
  assert.doesNotMatch(page, /rel="preload" as="video"/);
  assert.doesNotMatch(page, /Cinema with a pulse/);
  assert.match(styles, /\.featured-landing/);
  assert.match(styles, /\.film-grid \{ grid-template-columns: repeat\(3/);
  assert.match(styles, /\.branch-map/);
  assert.match(styles, /\.branch-map-featured/);
  assert.match(styles, /\.branch-track/);
  assert.match(styles, /\.flat-branch-tree/);
  assert.match(styles, /\.flat-tree-edges/);
  assert.match(styles, /\.branch-leaf-end/);
  assert.match(styles, /\.branch-leaf-end \{[^}]*pointer-events: auto/);
  assert.match(styles, /\.flat-tree-node\.branch-leaf:not\(\.is-selected\) \{ animation: leaf-lock-cue/);
  assert.match(styles, /\.featured-title/);
  assert.match(styles, /\.featured-tree-skeleton/);
  assert.match(styles, /\.featured-poster-overlay \{ display: none; \}/);
  assert.match(styles, /\.film-card-skeleton-copy/);
  assert.match(styles, /\.featured-media \{[^}]*aspect-ratio: 16\/9/);
  assert.doesNotMatch(styles, /\.site-nav/);
  assert.match(styles, /\.player-shell\.is-standard\.is-idle-playing/);
  assert.match(styles, /is-idle-playing \.watch-header \{ opacity: \.46/);
  assert.match(styles, /is-idle-playing \.branch-map,[^}]*opacity: \.34/);
  assert.match(styles, /\.branch-root-circle/);
  assert.match(styles, /\.branch-leaf\.is-selected/);
  assert.match(styles, /\.player-shell\.is-immersive/);
  assert.match(route, /listInteractivePublications/);
  assert.match(route, /category/);
  assert.match(route, /topic/);
  assert.match(detailRoute, /getInteractivePublication/);
  assert.match(watchPage, /initialPublicationId/);
  assert.match(watchPage, /initialPublication=\{publication\}/);
  assert.match(watchPage, /getPublication/);
  assert.match(watchPage, /generateMetadata/);
  assert.match(watchPage, /publication\.title/);
  assert.match(watchPage, /publication\.description/);
  assert.match(watchPage, /publication\.mainThumbnailUrl/);
  assert.match(watchPage, /summary_large_image/);
  assert.doesNotMatch(watchPage, /ImageResponse/);
  assert.match(styles, /height:\s*100svh/);
  assert.match(styles, /player-start/);
  assert.match(layout, /favicon\.svg\?v=6/);
  assert.match(favicon, /<rect/);
  assert.match(favicon, /#C5FF5C/i);
  assert.match(favicon, /<circle/);
  assert.doesNotMatch(favicon, /<text/);
  assert.match(packageJson, /"samsar-js": "0\.48\.48"/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("wires Creator Studio to shared auth, unified generation, detailed polling, and publication", async () => {
  const [
    studio,
    creatorPage,
    creatorSessionPage,
    creatorLogin,
    loginRoute,
    registerRoute,
    sessionRoute,
    creatorSessionRoute,
    generateRoute,
    statusRoute,
    publishRoute,
    generateMetaRoute,
    artifactRoute,
    branchPreview,
    branchTree,
    completedPlayer,
    publishDialog,
    creatorStyles,
    samsarClient,
    samsarAuth,
    clientAuth,
    serverAuth,
    creatorConfig,
    creatorModelCatalog,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../app/creator/creator-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/[sessionId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-login.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creator/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creator/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creator/status/[requestId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creator/publish/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creator/generate-meta/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/creator/artifact/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/branch-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/branch-tree.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/completed-player.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/publish-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator.module.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/samsar-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/samsar-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/client-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/creator-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/creator-model-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(creatorPage, /verifySamsarUser/);
  assert.match(creatorPage, /loadCreatorModelCatalog/);
  assert.match(creatorPage, /initialInferenceModels=\{catalog\.inferenceModels\}/);
  assert.match(creatorPage, /initialImageModels=\{catalog\.imageModels\}/);
  assert.match(creatorSessionPage, /initialSessionId=\{normalizedSessionId\}/);
  assert.match(creatorSessionPage, /loadCreatorModelCatalog/);
  assert.match(creatorSessionPage, /deploymentEdition=\{catalog\.deploymentEdition\}/);
  assert.match(creatorSessionPage, /params:\s*Promise<\{ sessionId: string \}>/);
  assert.match(loginRoute, /users\/login/);
  assert.match(loginRoute, /\{ authToken, user:/);
  assert.doesNotMatch(loginRoute, /createSamsarClient|new SamsarClient/);
  assert.match(registerRoute, /users\/register/);
  assert.match(registerRoute, /preferredLanguage/);
  assert.doesNotMatch(registerRoute, /createSamsarClient|new SamsarClient/);
  assert.match(sessionRoute, /bearerToken \|\|/);
  assert.match(sessionRoute, /Authorization: `Bearer \$\{authToken\}`/);
  assert.match(serverAuth, /Domain=\.samsar\.one/);
  assert.match(serverAuth, /SameSite=Lax/);
  assert.match(clientAuth, /localStorage\.setItem\(AUTH_TOKEN_KEY, token\)/);
  assert.match(clientAuth, /Domain=\.samsar\.one/);
  assert.match(creatorLogin, /\/api\/auth\/register/);
  assert.match(creatorLogin, /persistAuthToken\(result\.authToken\)/);
  assert.match(creatorLogin, /Authorization: `Bearer \$\{token\}`/);
  assert.match(generateRoute, /createCompatibleTextToInteractiveVideo/);
  assert.match(generateRoute, /getCreatorModelCatalog/);
  assert.match(generateRoute, /modelCatalog\.inferenceModels\.some/);
  assert.match(generateRoute, /modelCatalog\.imageModels\.some/);
  assert.match(generateRoute, /inference_model: inferenceModel/);
  assert.doesNotMatch(generateRoute, /IMAGE_MODELS/);
  assert.doesNotMatch(generateRoute, /\.postV2</);
  assert.match(generateRoute, /draft_session_id/);
  assert.match(generateRoute, /currentStatus !== "INIT"/);
  assert.match(generateRoute, /already been submitted/);
  assert.match(generateRoute, /duration < 30 \|\| duration > 180/);
  assert.match(generateRoute, /numLevels < 1 \|\| numLevels > 3/);
  assert.match(creatorSessionRoute, /createBlankBranchedSession/);
  assert.match(creatorSessionRoute, /forceNew/);
  assert.match(statusRoute, /getV2StatusDetailed/);
  assert.match(publishRoute, /publishPublication/);
  assert.match(publishRoute, /profile\.username/);
  assert.match(publishRoute, /categories/);
  assert.match(publishRoute, /topics/);
  assert.doesNotMatch(publishRoute, /Add at least one category and one topic/);
  assert.match(generateMetaRoute, /interactive_publication\/generate_meta/);
  assert.match(generateMetaRoute, /clientRequestId\.length > 200/);
  assert.match(generateMetaRoute, /sessionId\.length > 200/);
  assert.match(generateMetaRoute, /idempotencyKey: clientRequestId/);
  assert.match(generateMetaRoute, /creditsCharged/);
  assert.match(generateMetaRoute, /creditsRemaining/);
  assert.match(artifactRoute, /verifyAuthenticatedSamsarProfile/);
  assert.match(artifactRoute, /redirect:\s*"manual"/);
  assert.doesNotMatch(artifactRoute, /endsWith\("\.cloudfront\.net"\)/);
  assert.match(studio, /CREATOR_REQUEST_STORAGE_KEY/);
  assert.match(studio, /initialInferenceModels\.map/);
  assert.match(studio, /initialImageModels\.map/);
  assert.match(studio, /initialVideoModels\.map/);
  assert.doesNotMatch(studio, /NANOBANANA2/);
  assert.match(studio, /\[4, 5\]\.includes\(Number\(saved\.version\)\)/);
  assert.match(studio, /savedSessionId !== requestId/);
  assert.match(studio, /inference_model: form\.inferenceModel/);
  assert.match(studio, /effort: form\.inferenceEffort/);
  assert.match(studio, /Inference effort/);
  assert.match(generateRoute, /normalizeCreatorInferenceModel/);
  assert.match(generateRoute, /effort: inferenceEffort/);
  assert.match(studio, /!hasRequiredBranchedModels/);
  assert.match(studio, /!isStandaloneDeployment && user\.generationCredits <= 0/);
  assert.match(studio, /levels: DEFAULT_BRANCHING_LEVELS/);
  assert.match(studio, /POLL_INTERVAL_MS/);
  assert.match(studio, /pendingSubmissionRef/);
  assert.match(studio, /Create new/);
  assert.match(studio, /Only a new, unsubmitted session/);
  assert.match(studio, /form: reusableSettings/);
  assert.match(studio, /prompt: ""/);
  assert.match(studio, /router\.replace\(`\/creator\/\$\{encodeURIComponent\(nextRequestId\)\}`/);
  assert.match(studio, /renderStarted && <section/);
  assert.match(studio, /min=\{30\}/);
  assert.match(studio, /max=\{180\}/);
  assert.match(studio, /ZipPassThrough/);
  assert.doesNotMatch(studio, /zipSync/);
  assert.match(studio, /Download artifacts/);
  assert.match(studio, /Purchase credits/);
  assert.match(studio, /Math\.min\(100, Math\.max\(0, resolveProgress\(status\)\)\)/);
  assert.match(studio, /onCreditsRemaining/);
  assert.doesNotMatch(studio, /Interactive cinema engine/);
  assert.doesNotMatch(studio, /Public feed/);
  assert.doesNotMatch(studio, /avatarUrl/);
  assert.match(studio, /Create a <em>learning video\.<\/em>/);
  assert.match(studio, /educational, technical, or training lesson/);
  assert.doesNotMatch(studio, /Direct every|transmission|interactive film/i);
  assert.match(branchPreview, /audio_timeline/);
  assert.match(branchPreview, /chooseRandomPath/);
  assert.match(branchPreview, /sessionAspectRatio/);
  assert.match(branchPreview, /onLoadedMetadata/);
  assert.match(branchPreview, /naturalWidth/);
  assert.match(branchTree, /leaf_path_ids/);
  assert.match(completedPlayer, /switch_at_seconds/);
  assert.match(completedPlayer, /playerChoiceOverlay/);
  assert.match(completedPlayer, /requestVideoFrameCallback/);
  assert.match(completedPlayer, /CHOICE_AUDIO_FADE_LEAD_SECONDS/);
  assert.match(completedPlayer, /updateChoiceAudioFade/);
  assert.match(completedPlayer, /restoreChoiceAudioVolume/);
  assert.match(completedPlayer, /preload=\{isActive \? "auto" : "none"\}/);
  assert.match(completedPlayer, /preloadedThumbnailUrlsRef/);
  assert.match(completedPlayer, /nextChoiceThumbnailUrls/);
  assert.match(completedPlayer, /image\.decode\(\)/);
  assert.match(studio, /defaultOutput\.url[^>]*preload="auto"/);
  assert.match(publishDialog, /\/api\/creator\/generate-meta/);
  assert.match(publishDialog, /client_request_id: clientRequestId/);
  assert.match(publishDialog, /response\.status === 401/);
  assert.match(publishDialog, /response\.status === 402/);
  assert.match(publishDialog, /setTitle\(generatedTitle\.slice\(0, 160\)\)/);
  assert.match(publishDialog, /setDescription\(generatedDescription\.slice\(0, 2000\)\)/);
  assert.doesNotMatch(publishDialog, /Add at least one category and one topic/);
  assert.match(publishDialog, /Categories \(optional\)/);
  assert.match(publishDialog, /Topics \(optional\)/);
  assert.match(publishDialog, /categoryList/);
  assert.match(publishDialog, /topicList/);
  assert.match(publishDialog, /onCreditsRemaining/);
  assert.match(creatorStyles, /\.progressTrack\s*\{[^}]*overflow:\s*hidden/);
  assert.match(creatorStyles, /\.progressTrack span\s*\{[^}]*max-width:\s*100%/);
  const studioShellStyles = creatorStyles.match(/\.studioShell\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(studioShellStyles, /min-height:\s*100dvh/);
  assert.doesNotMatch(studioShellStyles, /(^|;)\s*height:\s*100dvh/);
  assert.doesNotMatch(studioShellStyles, /overflow-y:\s*auto/);
  assert.match(creatorStyles, /\.previewBody\s*\{[^}]*flex:\s*1 0 auto/);
  assert.match(creatorStyles, /\.previewStage\s*\{[^}]*aspect-ratio:\s*var\(--preview-aspect-ratio\)/);
  assert.match(creatorStyles, /\.previewMedia\s*\{[^}]*object-fit:\s*contain/);
  assert.match(creatorStyles, /\.previewStage\[data-orientation="portrait"\]/);
  assert.match(samsarClient, /authToken/);
  assert.match(samsarClient, /client\.createV2TextToInteractiveVideo/);
  assert.match(samsarClient, /client\.postV2<TextToInteractiveVideoCreateResponse>/);
  assert.match(samsarClient, /isLegacyInteractiveModelValidationError/);
  assert.doesNotMatch(samsarClient, /apiKey[,\s:]/);
  assert.match(samsarAuth, /verifyWithConfiguredToken\(\)/);
  assert.doesNotMatch(samsarAuth, /verifyClientSession\(\{\s*authToken/);
  assert.match(creatorModelCatalog, /video\/supported_models/);
  assert.match(creatorModelCatalog, /cache: "no-store"/);
  assert.match(creatorModelCatalog, /Array\.isArray\(record\.INFERENCE_MODELS\)/);
  assert.doesNotMatch(creatorModelCatalog, /!catalog\.imageModels\.length/);
  assert.doesNotMatch(creatorModelCatalog, /Authorization/);
  assert.match(creatorConfig, /availability and request validation always come from Samsar/);
  assert.match(creatorConfig, /model\.isBranchedInferenceModel === true/);
  assert.match(creatorConfig, /model\.isBranchedImageModel === true/);
  assert.match(creatorConfig, /model\.isBranchedVideoModel === true/);
  assert.doesNotMatch(creatorConfig, /NANOBANANA2/);
  assert.match(packageJson, /"fflate"/);
});
