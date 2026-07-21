"use client";

import {
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  BookOpen,
  LoaderCircle,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";
import type {
  ExternalNarrativeVideoModel,
  GlobalStatusDetailedResponse,
  NarrativeVideoBranchingStatus,
  TextToInteractiveVideoImageModel,
} from "samsar-js";
import { strToU8, Zip, ZipPassThrough } from "fflate";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreatorUser } from "../../lib/samsar-auth";
import {
  broadcastAuthEvent,
  cacheSharedCookieToken,
  clearAuthData,
} from "../../lib/client-auth";
import {
  CREATOR_REQUEST_STORAGE_KEY,
  IMAGE_MODELS,
  SAMSAR_BILLING_URL,
  VIDEO_MODELS,
  estimateInteractiveCredits,
} from "../../lib/creator-config";
import { BranchPreview, type BranchPreviewHandle } from "./branch-preview";
import { BranchTree, type BranchLayerSelection } from "./branch-tree";
import { CompletedPlayer } from "./completed-player";
import { CreatorBrand } from "./creator-brand";
import PublishDialog from "./publish-dialog";
import styles from "./creator.module.css";

type CreatorStatus = GlobalStatusDetailedResponse & {
  creditsCharged?: number;
  creditsRemaining?: number;
};

type GenerateResponse = {
  request_id?: string;
  session_id?: string;
  workflow_stage?: string;
  error?: string;
  creditsRemaining?: number;
};

type CreatorForm = {
  prompt: string;
  duration: number;
  imageModel: TextToInteractiveVideoImageModel;
  videoModel: ExternalNarrativeVideoModel;
  levels: number;
};

type PendingGenerationSubmission = {
  id: string;
  fingerprint: string;
};

type StoredCreatorState = {
  version: 3;
  sessionId: string;
  form: CreatorForm;
  pendingSubmission?: PendingGenerationSubmission;
};

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_BACKOFF_MS = 60_000;
const DEFAULT_BRANCHING_LEVELS = 2;
const COMPLETED_STAGE_STATUSES = new Set(["COMPLETED", "DONE", "SUCCESS", "SUCCEEDED"]);
const PIPELINE_STAGE_ORDER = [
  "prompt_generation",
  "image_generation",
  "speech_generation",
  "music_generation",
  "audio_generation",
  "ai_video_generation",
  "lip_sync_generation",
  "sound_effect_generation",
  "narrator_avatar_generation",
  "delete_reflow",
  "timeline_reflowed",
  "transcript_generation",
  "frame_generation",
  "video_generation",
] as const;
// Creator progress intentionally tracks a small set of aggregate checkpoints.
// A checkpoint only advances after the whole session (including every branch)
// has completed it; individual layers and paths never contribute fractions.
const CREATOR_PROGRESS_STAGES = [
  "prompt_generation",
  "image_generation",
  "audio_generation",
  "ai_video_generation",
  "frame_generation",
  "video_generation",
] as const;
const ARTIFACT_MEDIA_KEYS = new Set([
  "url",
  "resulturl",
  "resulturls",
  "thumbnailurl",
  "remoteurl",
  "videolink",
  "remoteaudiolinks",
]);

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function getBranching(status: CreatorStatus | null) {
  return (
    status?.branching ??
    status?.session?.branching ??
    null
  ) as NarrativeVideoBranchingStatus | null;
}

function isCompleted(status: CreatorStatus | null) {
  const branching = getBranching(status);
  return status?.status?.toUpperCase() === "COMPLETED" && branching?.outputs.ready === true;
}

function isFailed(status: CreatorStatus | null) {
  const normalized = status?.status?.toUpperCase();
  return normalized === "FAILED" || normalized === "CANCELLED";
}

function isInitSession(status: CreatorStatus | null, allowLegacyDraft = false) {
  const normalized = status?.status?.toUpperCase();
  if (normalized === "INIT" || normalized === "DRAFT") return true;
  if (!allowLegacyDraft || normalized !== "PENDING") return false;

  const responseRecord = status as Record<string, unknown> | null;
  const prompt = status?.session?.inputPrompt ?? responseRecord?.input_prompt ?? responseRecord?.prompt;
  return !(
    (typeof prompt === "string" && prompt.trim()) ||
    status?.session?.layers?.length ||
    status?.session?.audioLayers?.length ||
    getBranching(status)?.paths?.length
  );
}

function statusMessage(status: CreatorStatus | null) {
  if (!status) return null;
  return status.expressGenerationError || status.message || null;
}

function billingUrl() {
  if (typeof window === "undefined") return SAMSAR_BILLING_URL;
  const url = new URL(SAMSAR_BILLING_URL);
  url.searchParams.set("source", "tmochi");
  return url.toString();
}

function returnToSignIn() {
  clearAuthData();
  broadcastAuthEvent("logout");
  window.location.reload();
}

function resolveStage(status: CreatorStatus | null, hasRequest: boolean) {
  if (!hasRequest) return "Ready to create a lesson";
  if (!status) return "Preparing the lesson workspace";
  if (isCompleted(status)) return "Interactive lesson ready";
  if (isFailed(status)) return "Lesson generation stopped";
  const sessionStage = status.session?.currentStage || status.session?.previewStage;
  const stage = String(sessionStage || "").toLowerCase();
  if (stage === "prompt_generation") return "Structuring the interactive lesson";
  if (stage === "image_generation") return "Creating lesson visuals";
  if (["speech_generation", "music_generation", "audio_generation"].includes(stage)) {
    return "Adding narration and audio";
  }
  if (stage === "ai_video_generation") return "Animating lesson scenes";
  if (["lip_sync_generation", "sound_effect_generation", "narrator_avatar_generation"].includes(stage)) {
    return "Polishing lesson media";
  }
  if (["delete_reflow", "timeline_reflowed", "transcript_generation"].includes(stage)) {
    return "Assembling learning paths";
  }
  if (stage === "frame_generation") return "Rendering lesson scenes";
  if (stage === "video_generation") return "Encoding the interactive lesson";
  if (getBranching(status)?.paths?.length) return "Mapping learning paths";
  return "Structuring the interactive lesson";
}

function normalizedStageStatus(value: unknown) {
  if (value && typeof value === "object" && "status" in value) {
    return String((value as { status?: unknown }).status || "").trim().toUpperCase();
  }
  return String(value || "").trim().toUpperCase();
}

function aggregateStageCompleted(status: CreatorStatus, stage: string) {
  const branching = getBranching(status);
  if (stage === "frame_generation" && branching?.paths?.length) {
    const allBranchFramesComplete = branching.paths.every((path) => {
      const frameStatus = normalizedStageStatus(path.stages?.frame_generation);
      return COMPLETED_STAGE_STATUSES.has(frameStatus) ||
        COMPLETED_STAGE_STATUSES.has(normalizedStageStatus(path.status));
    });
    if (!allBranchFramesComplete) return false;
  }
  if (stage === "video_generation" && branching?.paths?.length) {
    const allBranchVideosComplete = branching.paths.every((path) => {
      const videoStatus = normalizedStageStatus(path.stages?.video_generation);
      return COMPLETED_STAGE_STATUSES.has(videoStatus) ||
        COMPLETED_STAGE_STATUSES.has(normalizedStageStatus(path.status));
    });
    if (!allBranchVideosComplete) return false;
  }

  const completedStages = status.session?.completedStages ?? [];
  if (completedStages.some((completedStage) => String(completedStage).trim().toLowerCase() === stage)) {
    return true;
  }

  const stageStatus = status.session?.stages?.[stage];
  if (COMPLETED_STAGE_STATUSES.has(normalizedStageStatus(stageStatus))) return true;
  if (stageStatus !== undefined && stageStatus !== null) return false;

  // Older detailed responses may expose only currentStage. Because currentStage
  // is the first unfinished aggregate stage, every preceding stage is complete.
  const currentStage = String(status.session?.currentStage || "").trim().toLowerCase();
  const currentIndex = PIPELINE_STAGE_ORDER.indexOf(currentStage as typeof PIPELINE_STAGE_ORDER[number]);
  const targetIndex = PIPELINE_STAGE_ORDER.indexOf(stage as typeof PIPELINE_STAGE_ORDER[number]);
  return currentIndex > targetIndex && targetIndex >= 0;
}

function resolveProgress(status: CreatorStatus | null) {
  if (isCompleted(status)) return 100;
  if (!status) return 0;

  let completedStages = 0;
  for (const stage of CREATOR_PROGRESS_STAGES) {
    if (!aggregateStageCompleted(status, stage)) break;
    completedStages += 1;
  }
  return Math.min(99, (completedStages / CREATOR_PROGRESS_STAGES.length) * 100);
}

function resolveCreditsCharged(status: CreatorStatus | null) {
  if (!status) return null;
  const record = status as Record<string, unknown>;
  const chargeSummary = record.expressGenerationCreditCharges ??
    record.express_generation_credit_charges;
  const totalCharged = chargeSummary && typeof chargeSummary === "object"
    ? (chargeSummary as Record<string, unknown>).totalCharged
    : undefined;
  for (const candidate of [status.creditsCharged, record.credits_charged, totalCharged]) {
    if (Number.isFinite(Number(candidate))) return Math.max(0, Number(candidate));
  }
  return null;
}

function suggestedTitle(prompt: string) {
  const firstSentence = prompt.trim().split(/[.!?\n]/)[0]?.trim() || "Untitled interactive lesson";
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trim()}…` : firstSentence;
}

function sanitizeFileName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "artifact";
}

function mediaExtension(contentType: string | null) {
  if (contentType?.includes("video/mp4")) return ".mp4";
  if (contentType?.includes("audio/mpeg")) return ".mp3";
  if (contentType?.includes("audio/wav")) return ".wav";
  if (contentType?.includes("image/png")) return ".png";
  if (contentType?.includes("image/webp")) return ".webp";
  if (contentType?.includes("image/jpeg")) return ".jpg";
  return "";
}

function collectArtifactUrls(value: unknown, urls = new Set<string>(), key = "") {
  if (typeof value === "string") {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    if (ARTIFACT_MEDIA_KEYS.has(normalizedKey) && /^https:\/\//i.test(value)) {
      urls.add(value);
    }
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectArtifactUrls(item, urls, key));
    return urls;
  }
  if (!value || typeof value !== "object") return urls;
  Object.entries(value as Record<string, unknown>).forEach(([nextKey, nextValue]) => {
    collectArtifactUrls(nextValue, urls, nextKey);
  });
  return urls;
}

function normalizeStoredForm(value: unknown): CreatorForm | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<CreatorForm>;
  if (
    typeof stored.prompt !== "string" ||
    !Number.isFinite(Number(stored.duration)) ||
    !Number.isInteger(Number(stored.levels)) ||
    !IMAGE_MODELS.some((model) => model.value === stored.imageModel) ||
    !VIDEO_MODELS.some((model) => model.value === stored.videoModel)
  ) {
    return null;
  }
  return {
    prompt: stored.prompt.slice(0, 4000),
    duration: Math.min(180, Math.max(30, Number(stored.duration))),
    imageModel: stored.imageModel as TextToInteractiveVideoImageModel,
    videoModel: stored.videoModel as ExternalNarrativeVideoModel,
    levels: Math.min(3, Math.max(1, Number(stored.levels))),
  };
}

function addArchiveBytes(zip: Zip, name: string, data: Uint8Array) {
  const entry = new ZipPassThrough(name);
  zip.add(entry);
  entry.push(data, true);
}

async function addArchiveResponse(zip: Zip, name: string, response: Response) {
  if (!response.body) throw new Error(`Artifact ${name} did not include a response body.`);
  const entry = new ZipPassThrough(name);
  zip.add(entry);
  const reader = response.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    entry.push(chunk.value);
  }
  entry.push(new Uint8Array(), true);
}

export default function CreatorStudio({
  initialUser,
  initialSessionId = "",
  initialDraft = false,
}: {
  initialUser: CreatorUser;
  initialSessionId?: string;
  initialDraft?: boolean;
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [form, setForm] = useState<CreatorForm>({
    prompt: "",
    duration: 30,
    imageModel: "NANOBANANA2",
    videoModel: "COSMOS3SUPERI2V",
    levels: DEFAULT_BRANCHING_LEVELS,
  });
  const [requestId, setRequestId] = useState(initialSessionId.trim());
  const [isDraft, setIsDraft] = useState(initialDraft || !initialSessionId.trim());
  const [renderStarted, setRenderStarted] = useState(
    Boolean(initialSessionId.trim()) && !initialDraft,
  );
  const [status, setStatus] = useState<CreatorStatus | null>(null);
  const [lastDetailedSnapshot, setLastDetailedSnapshot] = useState<CreatorStatus | null>(null);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [previewSeekTarget, setPreviewSeekTarget] = useState<BranchLayerSelection | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const latestRequestRef = useRef("");
  const branchPreviewRef = useRef<BranchPreviewHandle | null>(null);
  const pendingSubmissionRef = useRef<PendingGenerationSubmission | null>(null);
  const draftCreationRef = useRef(false);
  const storageScope = initialUser.id || initialUser.email || initialUser.username || "creator";
  const creatorStorageKey = `${CREATOR_REQUEST_STORAGE_KEY}:${storageScope}`;

  const estimatedCredits = useMemo(
    () => estimateInteractiveCredits(form.duration, form.levels, form.videoModel),
    [form.duration, form.levels, form.videoModel],
  );
  const branching = getBranching(status) ?? getBranching(lastDetailedSnapshot);
  const branchLayerCount = new Set(
    (branching?.paths ?? []).flatMap((path) =>
      (path.timeline ?? []).map((item) => item.layer_id ?? `scene-${item.scene_index ?? item.sequence_index}`),
    ),
  ).size;
  const complete = renderStarted && isCompleted(status);
  const failed = renderStarted && isFailed(status);
  const inProgress = renderStarted && !complete && !failed;
  const progress = Math.min(100, Math.max(0, resolveProgress(status)));
  const stage = resolveStage(status, renderStarted);
  const creditsCharged = resolveCreditsCharged(status);
  const balanceMayBeShort = !renderStarted && user.generationCredits < estimatedCredits;

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (response.status === 401) {
        returnToSignIn();
        return;
      }
      if (!response.ok) return;
      const result = await response.json() as { user?: CreatorUser };
      if (result.user) setUser(result.user);
    } catch {
      // A stale balance is preferable to interrupting an active render.
    }
  }, []);

  useEffect(() => {
    // A shared .samsar.one cookie is the cross-subdomain source of truth. Cache
    // it locally so browser-side Samsar integrations use the same convention.
    cacheSharedCookieToken();
  }, []);

  useEffect(() => {
    if (initialSessionId.trim() || draftCreationRef.current) return;
    draftCreationRef.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/creator/session", { method: "POST" });
        const result = await response.json().catch(() => null) as {
          sessionId?: string;
          status?: string;
          error?: string;
        } | null;
        if (response.status === 401) {
          returnToSignIn();
          return;
        }
        if (!response.ok || !result?.sessionId) {
          throw new Error(result?.error || "Unable to create a Creator Studio session.");
        }
        setRequestId(result.sessionId);
        const nextIsDraft = result.status?.toUpperCase() === "INIT";
        setIsDraft(nextIsDraft);
        setRenderStarted(!nextIsDraft);
        setSessionChecked(true);
        router.replace(`/creator/${encodeURIComponent(result.sessionId)}${nextIsDraft ? "?draft=1" : ""}`, {
          scroll: false,
        });
      } catch (draftError) {
        setError(
          draftError instanceof Error
            ? draftError.message
            : "Unable to create a Creator Studio session.",
        );
      }
    })();
  }, [initialSessionId, router]);

  useEffect(() => {
    // Remove legacy/unscoped records; the route is now the canonical session ID.
    window.localStorage.removeItem("tmochi.creator.request-id.v1");
    window.localStorage.removeItem(CREATOR_REQUEST_STORAGE_KEY);
    const raw = window.localStorage.getItem(creatorStorageKey)?.trim();
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<StoredCreatorState>;
      const savedSessionId = typeof saved.sessionId === "string"
        ? saved.sessionId.trim()
        : "";
      if (saved.version !== 3 || !requestId || savedSessionId !== requestId) {
        window.localStorage.removeItem(creatorStorageKey);
        return;
      }
      const savedForm = normalizeStoredForm(saved.form);
      const pending = saved.pendingSubmission;
      const savedPending =
        pending &&
        typeof pending.id === "string" &&
        pending.id.trim() &&
        typeof pending.fingerprint === "string" &&
        pending.fingerprint
          ? { id: pending.id.trim(), fingerprint: pending.fingerprint }
          : null;
      window.setTimeout(() => {
        if (savedForm) setForm({ ...savedForm, prompt: "" });
        pendingSubmissionRef.current = savedPending;
      }, 0);
    } catch {
      window.localStorage.removeItem(creatorStorageKey);
    }
  }, [creatorStorageKey, requestId]);

  useEffect(() => {
    latestRequestRef.current = requestId;
    if (!requestId) {
      return;
    }

    let disposed = false;
    let timer: number | null = null;
    let consecutiveErrors = 0;

    const schedule = (delay: number) => {
      if (!disposed) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (disposed || latestRequestRef.current !== requestId) return;
      setPolling(true);
      try {
        const response = await fetch(`/api/creator/status/${encodeURIComponent(requestId)}`, {
          cache: "no-store",
        });
        const next = await response.json().catch(() => null) as (CreatorStatus & { error?: string }) | null;
        if (response.status === 401) {
          returnToSignIn();
          return;
        }
        if (response.status === 402) {
          window.location.assign(billingUrl());
          return;
        }
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 425, 429].includes(response.status)
        ) {
          const permanentMessage =
            next?.error ||
            "This generation is no longer available to this account. Start a new draft to continue.";
          setStatus({
            request_id: requestId,
            status: "FAILED",
            message: permanentMessage,
          } as CreatorStatus);
          setIsDraft(false);
          setRenderStarted(true);
          setSessionChecked(true);
          setError(permanentMessage);
          setPolling(false);
          return;
        }
        if (!response.ok || !next) {
          throw new Error(next?.error || "The render status is temporarily unavailable.");
        }
        if (disposed || latestRequestRef.current !== requestId) return;

        consecutiveErrors = 0;
        const nextIsInit = isInitSession(next, initialDraft);
        setStatus(next);
        setIsDraft(nextIsInit);
        setRenderStarted(!nextIsInit);
        setSessionChecked(true);
        setError(null);
        const responseRecord = next as Record<string, unknown>;
        const sessionRecord = next.session as Record<string, unknown> | null | undefined;
        const nextImageModel =
          sessionRecord?.image_model ?? sessionRecord?.imageModel ??
          responseRecord.image_model ?? responseRecord.imageModel;
        const nextVideoModel =
          sessionRecord?.video_model ?? sessionRecord?.videoModel ??
          responseRecord.video_model ?? responseRecord.videoModel;
        const nextPrompt =
          next.session?.inputPrompt ?? responseRecord.input_prompt ?? responseRecord.prompt;
        const nextDuration = next.session?.duration ?? responseRecord.duration;
        const nextLevels = getBranching(next)?.tree.num_levels;
        setForm((current) => nextIsInit
          ? { ...current, prompt: "" }
          : {
              prompt:
                typeof nextPrompt === "string" && nextPrompt.trim()
                  ? nextPrompt
                  : current.prompt,
              duration: Number.isFinite(Number(nextDuration))
                ? Math.min(180, Math.max(30, Number(nextDuration)))
                : current.duration,
              imageModel: IMAGE_MODELS.some((model) => model.value === nextImageModel)
                ? nextImageModel as TextToInteractiveVideoImageModel
                : current.imageModel,
              videoModel: VIDEO_MODELS.some((model) => model.value === nextVideoModel)
                ? nextVideoModel as ExternalNarrativeVideoModel
                : current.videoModel,
              levels: Number.isInteger(Number(nextLevels))
                ? Math.min(3, Math.max(1, Number(nextLevels)))
                : current.levels,
            });
        if (
          next.session?.layers?.length ||
          next.session?.audioLayers?.length ||
          getBranching(next)?.paths?.some((path) => path.timeline?.length)
        ) {
          setLastDetailedSnapshot(next);
        }
        const nextBranching = getBranching(next);
        setActivePathId((current) => current || nextBranching?.default_path_id || null);
        if (typeof next.creditsRemaining === "number") {
          setUser((current) => ({ ...current, generationCredits: next.creditsRemaining as number }));
        }

        const terminal = nextIsInit || isCompleted(next) || isFailed(next);
        if (terminal) {
          setPolling(false);
          void refreshUser();
          const failureText = `${statusMessage(next) || ""}`.toLowerCase();
          if (isFailed(next) && failureText.includes("insufficient") && failureText.includes("credit")) {
            window.location.assign(billingUrl());
          }
          return;
        }
        schedule(POLL_INTERVAL_MS);
      } catch (pollError) {
        if (disposed) return;
        consecutiveErrors += 1;
        setPolling(false);
        setSessionChecked(false);
        setError(pollError instanceof Error ? pollError.message : "The render status is temporarily unavailable.");
        const delay = Math.min(
          MAX_POLL_BACKOFF_MS,
          POLL_INTERVAL_MS * Math.pow(2, Math.min(consecutiveErrors, 4)),
        );
        schedule(delay);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [initialDraft, refreshUser, requestId]);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionChecked || !isDraft || renderStarted || (status && !isInitSession(status, initialDraft))) {
      setError("Only a new, unsubmitted session can start a generation.");
      return;
    }
    if (!form.prompt.trim()) {
      setError("Describe what learners should understand or practice.");
      return;
    }
    if (user.generationCredits <= 0) {
      window.location.assign(billingUrl());
      return;
    }

    const submittedDraftId = isDraft ? requestId : "";
    setGenerating(true);
    setRenderStarted(true);
    setError(null);
    setStatus(null);
    setLastDetailedSnapshot(null);
    setActivePathId(null);
    try {
      const generationPayload = {
        prompt: form.prompt.trim(),
        duration: form.duration,
        image_model: form.imageModel,
        video_model: form.videoModel,
        num_levels: form.levels,
      };
      const fingerprint = JSON.stringify(generationPayload);
      const reusableSubmission = pendingSubmissionRef.current?.fingerprint === fingerprint
        ? pendingSubmissionRef.current
        : null;
      const clientRequestId = reusableSubmission?.id || (
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      );
      pendingSubmissionRef.current = { id: clientRequestId, fingerprint };
      window.localStorage.setItem(creatorStorageKey, JSON.stringify({
        version: 3,
        sessionId: submittedDraftId,
        form,
        pendingSubmission: pendingSubmissionRef.current,
      } satisfies StoredCreatorState));
      const response = await fetch("/api/creator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...generationPayload,
          client_request_id: clientRequestId,
          ...(submittedDraftId ? { draft_session_id: submittedDraftId } : {}),
        }),
      });
      const result = await response.json().catch(() => null) as GenerateResponse | null;
      if (response.status === 401) {
        pendingSubmissionRef.current = null;
        window.localStorage.removeItem(creatorStorageKey);
        returnToSignIn();
        return;
      }
      if (response.status === 402) {
        pendingSubmissionRef.current = null;
        window.localStorage.setItem(creatorStorageKey, JSON.stringify({
          version: 3,
          sessionId: submittedDraftId,
          form,
        } satisfies StoredCreatorState));
        window.location.assign(billingUrl());
        return;
      }
      if (!response.ok) {
        const generationMessage = result?.error || "Unable to start this generation.";
        if (response.status === 409 && submittedDraftId) {
          setIsDraft(false);
          setRenderStarted(true);
          setStatus({
            request_id: submittedDraftId,
            status: "PENDING",
            message: generationMessage,
          } as CreatorStatus);
          router.replace(`/creator/${encodeURIComponent(submittedDraftId)}`, { scroll: false });
        }
        if (
          generationMessage.toLowerCase().includes("insufficient") &&
          generationMessage.toLowerCase().includes("credit")
        ) {
          pendingSubmissionRef.current = null;
          window.localStorage.setItem(creatorStorageKey, JSON.stringify({
            version: 3,
            sessionId: submittedDraftId,
            form,
          } satisfies StoredCreatorState));
          window.location.assign(billingUrl());
          return;
        }
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 425, 429].includes(response.status)
        ) {
          pendingSubmissionRef.current = null;
          window.localStorage.setItem(creatorStorageKey, JSON.stringify({
            version: 3,
            sessionId: submittedDraftId,
            form,
          } satisfies StoredCreatorState));
        }
        throw new Error(generationMessage);
      }
      const nextRequestId = result?.request_id || result?.session_id || "";
      if (!nextRequestId) throw new Error("Samsar did not return a render request ID.");
      pendingSubmissionRef.current = null;
      window.localStorage.setItem(creatorStorageKey, JSON.stringify({
        version: 3,
        sessionId: nextRequestId,
        form,
      } satisfies StoredCreatorState));
      setIsDraft(false);
      setRequestId(nextRequestId);
      router.replace(`/creator/${encodeURIComponent(nextRequestId)}`, { scroll: false });
      if (typeof result?.creditsRemaining === "number") {
        setUser((current) => ({ ...current, generationCredits: result.creditsRemaining as number }));
      }
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to start this generation.");
      if (submittedDraftId) setRenderStarted(false);
    } finally {
      setGenerating(false);
    }
  }

  async function newDraft() {
    if (creatingDraft || generating) return;
    setCreatingDraft(true);
    const reusableSettings = {
      ...form,
      prompt: "",
      // Branch depth is request-defining state. A new draft starts from the
      // server's two-level default instead of inheriting the previous run.
      levels: DEFAULT_BRANCHING_LEVELS,
    };
    try {
      const response = await fetch("/api/creator/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceNew: true }),
      });
      const result = await response.json().catch(() => null) as {
        sessionId?: string;
        error?: string;
      } | null;
      if (!response.ok || !result?.sessionId) {
        throw new Error(result?.error || "Unable to create a new draft.");
      }
      pendingSubmissionRef.current = null;
      window.localStorage.setItem(creatorStorageKey, JSON.stringify({
        version: 3,
        sessionId: result.sessionId,
        form: reusableSettings,
      } satisfies StoredCreatorState));
      setForm(reusableSettings);
      setStatus(null);
      setLastDetailedSnapshot(null);
      setActivePathId(null);
      setPreviewSeekTarget(null);
      setError(null);
      setPlayerOpen(false);
      setPublishOpen(false);
      setRenderStarted(false);
      setRequestId(result.sessionId);
      setIsDraft(true);
      setSessionChecked(true);
      router.push(`/creator/${encodeURIComponent(result.sessionId)}?draft=1`);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Unable to create a new draft.");
    } finally {
      setCreatingDraft(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.localStorage.removeItem(creatorStorageKey);
    clearAuthData();
    broadcastAuthEvent("logout");
    window.location.replace("/creator");
  }

  async function downloadArtifacts() {
    if (!status || !requestId || downloading) return;
    setDownloading(true);
    setDownloadProgress(0);
    setError(null);
    try {
      const snapshot = lastDetailedSnapshot;
      const source = { completed: status, detailedSnapshot: snapshot };
      const artifactUrls = [...collectArtifactUrls(source)];
      const archiveChunks: Array<Uint8Array<ArrayBuffer>> = [];
      let archiveError: Error | null = null;
      let resolveArchive: (() => void) | null = null;
      let rejectArchive: ((error: Error) => void) | null = null;
      const archiveComplete = new Promise<void>((resolve, reject) => {
        resolveArchive = resolve;
        rejectArchive = reject;
      });
      const zip = new Zip((zipError, chunk, final) => {
        if (zipError) {
          archiveError = zipError;
          rejectArchive?.(zipError);
          return;
        }
        archiveChunks.push(chunk);
        if (final) resolveArchive?.();
      });

      addArchiveBytes(zip, "manifest/status-detailed.json", strToU8(JSON.stringify(status, null, 2)));
      addArchiveBytes(zip, "manifest/branching.json", strToU8(JSON.stringify(getBranching(status), null, 2)));
      addArchiveBytes(zip, "manifest/timing.json", strToU8(JSON.stringify({
          timing: getBranching(status)?.timing,
          tree: getBranching(status)?.tree,
          pendingPathTimelines: getBranching(snapshot)?.paths?.map((path) => ({
            path_id: path.path_id,
            timeline: path.timeline,
            audio_timeline: path.audio_timeline,
            selection_trail: path.selection_trail,
          })) ?? [],
        }, null, 2)));
      if (snapshot) {
        addArchiveBytes(zip, "manifest/last-render-snapshot.json", strToU8(JSON.stringify(snapshot, null, 2)));
      }

      const index: Array<{ source: string; file: string }> = [];
      try {
        for (let offset = 0; offset < artifactUrls.length; offset += 1) {
          const sourceUrl = artifactUrls[offset];
          const response = await fetch(`/api/creator/artifact?url=${encodeURIComponent(sourceUrl)}`);
          if (!response.ok) {
            const failure = await response.json().catch(() => null) as { error?: string } | null;
            throw new Error(
              failure?.error ||
              `Artifact ${offset + 1} of ${artifactUrls.length} could not be downloaded. No partial archive was saved.`,
            );
          }
          const parsed = new URL(sourceUrl);
          const rawName = decodeURIComponent(parsed.pathname.split("/").pop() || `artifact-${offset + 1}`);
          const extension = /\.[a-zA-Z0-9]{2,5}$/.test(rawName)
            ? ""
            : mediaExtension(response.headers.get("content-type"));
          const fileName = `media/${String(offset + 1).padStart(2, "0")}-${sanitizeFileName(rawName)}${extension}`;
          await addArchiveResponse(zip, fileName, response);
          index.push({ source: sourceUrl, file: fileName });
          setDownloadProgress(Math.round(((offset + 1) / Math.max(artifactUrls.length, 1)) * 90));
        }
        addArchiveBytes(zip, "manifest/artifact-index.json", strToU8(JSON.stringify(index, null, 2)));
        addArchiveBytes(
          zip,
          "README.txt",
          strToU8(
            "TMochiLearn interactive video artifacts\n\n" +
            "Start with manifest/branching.json. All switch times and durations use media-relative seconds.\n" +
            "manifest/artifact-index.json maps every remote resource to its packaged media file.\n",
          ),
        );
        zip.end();
        await archiveComplete;
      } catch (error) {
        zip.terminate();
        throw error;
      }
      if (archiveError) throw archiveError;
      setDownloadProgress(100);
      const blob = new Blob(archiveChunks, { type: "application/zip" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `tmochi-learn-${sanitizeFileName(requestId)}-artifacts.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to build the artifact archive.");
    } finally {
      setDownloading(false);
    }
  }

  const outputPaths = complete && getBranching(status)?.outputs.ready
    ? getBranching(status)?.outputs.paths ?? []
    : [];
  const defaultOutput = outputPaths.find((path) => path.is_default) || outputPaths[0];
  const statusDetail = statusMessage(status);

  return (
    <main className={styles.studioShell}>
      <header className={styles.studioHeader}>
        <div className={styles.headerIdentity}>
          <Link className={styles.headerBrand} href="/" aria-label="TMochiLearn home"><CreatorBrand /></Link>
          <span className={styles.headerDivider} />
          <div>
            <strong>Creator Studio</strong>
          </div>
          <button
            className={styles.createNewButton}
            type="button"
            onClick={() => void newDraft()}
            disabled={creatingDraft || generating}
          >
            {creatingDraft ? <LoaderCircle className={styles.spin} size={13} /> : <Plus size={13} />}
            Create new
          </button>
        </div>
        <div className={styles.creditCluster}>
          <div className={`${styles.estimateCard} ${balanceMayBeShort ? styles.estimateWarning : ""}`}>
            <span><Zap size={13} /> {renderStarted ? (complete ? "Credits charged" : "Charged so far") : "Estimated up to"}</span>
            <strong>{numberFormatter.format(renderStarted && creditsCharged !== null ? creditsCharged : estimatedCredits)} credits</strong>
          </div>
          <div className={styles.balanceCard}>
            <span>Available balance</span>
            <strong>{numberFormatter.format(user.generationCredits)}</strong>
          </div>
          <button className={styles.purchaseButton} type="button" onClick={() => window.location.assign(billingUrl())}>
            <WalletCards size={15} /> <span>Purchase credits</span>
          </button>
          <button className={styles.signOutButton} type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <div className={`${styles.studioGrid} ${renderStarted ? styles.studioGridActive : styles.studioGridDraft}`}>
        <aside className={styles.controlPanel}>
          <div className={styles.panelHeading}>
            <span className={styles.eyebrow}>Interactive video creator</span>
            <h1>Create a <em>learning video.</em></h1>
            <p>Build an educational, technical, or training lesson where learners make choices and explore outcomes.</p>
          </div>

          <form className={styles.creatorForm} onSubmit={generate}>
            <label className={styles.promptField}>
              <span>Lesson brief <small>{form.prompt.length}/4,000</small></span>
              <textarea
                value={form.prompt}
                onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                maxLength={4000}
                rows={7}
                placeholder="What should learners understand or practice?"
                disabled={inProgress || generating}
                required
              />
            </label>

            <div className={styles.durationField}>
              <div className={styles.fieldTitle}>
                <span>Lesson length</span>
                <label>
                  <input
                    type="number"
                    min={30}
                    max={180}
                    value={form.duration}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      duration: Math.min(180, Math.max(30, Number(event.target.value) || 30)),
                    }))}
                    disabled={inProgress || generating}
                    aria-label="Duration in seconds"
                  />
                  <span>sec</span>
                </label>
              </div>
              <input
                type="range"
                min={30}
                max={180}
                step={5}
                value={form.duration}
                onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}
                disabled={inProgress || generating}
                style={{ "--range-progress": `${((form.duration - 30) / 150) * 100}%` } as React.CSSProperties}
                aria-label="Select duration"
              />
              <div className={styles.rangeTicks}><span>30 sec</span><span>3 min</span></div>
            </div>

            <div className={styles.selectGrid}>
              <label>
                <span>Visual model</span>
                <div className={styles.selectWrap}>
                  <select
                    value={form.imageModel}
                    onChange={(event) => setForm((current) => ({ ...current, imageModel: event.target.value as TextToInteractiveVideoImageModel }))}
                    disabled={inProgress || generating}
                  >
                    {IMAGE_MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
              <label>
                <span>Motion model</span>
                <div className={styles.selectWrap}>
                  <select
                    value={form.videoModel}
                    onChange={(event) => setForm((current) => ({ ...current, videoModel: event.target.value as ExternalNarrativeVideoModel }))}
                    disabled={inProgress || generating}
                  >
                    {VIDEO_MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </label>
            </div>

            <fieldset className={styles.levelField} disabled={inProgress || generating}>
              <legend>
                <span>Choice depth</span>
                <small>{Math.pow(2, form.levels)} learning paths</small>
              </legend>
              <div>
                {[1, 2, 3].map((level) => (
                  <button
                    className={form.levels === level ? styles.levelActive : ""}
                    type="button"
                    key={level}
                    onClick={() => setForm((current) => ({ ...current, levels: level }))}
                    aria-pressed={form.levels === level}
                  >
                    <strong>{level}</strong>
                    <span>{Math.pow(2, level)} routes</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <div className={styles.formError} role="alert">{error}</div>}
            {balanceMayBeShort && !inProgress && (
              <div className={styles.creditWarning}>
                <CircleDollarSign size={16} />
                <span>Your balance may be too low for this lesson. Shared scenes are only billed once.</span>
              </div>
            )}

            <button
              className={styles.generateButton}
              type="submit"
              disabled={generating || !form.prompt.trim() || !sessionChecked || !isDraft || renderStarted}
            >
                {generating ? <LoaderCircle className={styles.spin} size={18} /> : <Sparkles size={18} />}
                <span>{generating
                  ? "Starting lesson"
                  : !sessionChecked
                    ? "Checking session"
                    : inProgress
                      ? "Generation in progress"
                      : complete
                        ? "Generation complete"
                        : failed
                          ? "Session unavailable"
                          : "Create interactive video"}</span>
                {!generating && !renderStarted && <Zap size={15} />}
            </button>
            {renderStarted && (
              <div className={styles.activeRequestActions}>
                <span>{inProgress && <LoaderCircle className={styles.spin} size={13} />} This lesson is already being created</span>
              </div>
            )}
            <p className={styles.estimateNote}>Estimate is based on model, lesson length, and learning paths. Shared scenes are billed once.</p>
          </form>
        </aside>

        {renderStarted && <section className={styles.previewPanel} aria-label="Interactive video preview">
          <div className={styles.previewHeader}>
            <div>
                <span className={styles.statusDot} data-state={complete ? "complete" : failed ? "failed" : "active"} />
              <div>
                <strong>{stage}</strong>
                <span>{isDraft ? "Reserving the render session" : `Session ${requestId.slice(0, 8)}…`}</span>
              </div>
            </div>
            {!isDraft && requestId && (
              <div className={styles.progressReadout}>
                <span>{polling && !complete && !failed ? "Live status" : complete ? "Ready" : failed ? "Stopped" : "Syncing"}</span>
                <strong>{Math.round(progress)}%</strong>
              </div>
            )}
          </div>

          {!isDraft && requestId && (
            <div className={styles.progressTrack} aria-label={`${Math.round(progress)} percent complete`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className={styles.previewBody}>
            {isDraft && generating && (
              <div className={styles.renderOpening}>
                <LoaderCircle className={styles.spin} size={24} />
                <span className={styles.eyebrow}>Preparing your lesson</span>
                <h2>Building the learning paths.</h2>
                <p>Your interactive lesson map will appear here shortly.</p>
              </div>
            )}

            {!isDraft && requestId && (
              <>
                <div className={styles.treeSection}>
                  <div className={styles.sectionLabel}>
                    <span>Learning path map</span>
                    <small>
                      {branchLayerCount > 0
                        ? `${branchLayerCount} layers · click any scene to preview`
                        : branching?.tree.num_levels
                          ? `${branching.tree.num_levels} levels`
                          : "Mapping lesson paths"}
                    </small>
                  </div>
                  <BranchTree
                    branching={branching}
                    layers={(lastDetailedSnapshot || status)?.session?.layers ?? []}
                    activePathId={activePathId}
                    selectedLayerKey={previewSeekTarget?.key}
                    onLayerSelect={(selection) => {
                      setActivePathId(selection.pathId);
                      setPreviewSeekTarget(selection);
                      branchPreviewRef.current?.seekTo(selection);
                    }}
                  />
                </div>

                {!complete && !failed && (
                  <div className={styles.livePreviewSection}>
                    <div className={styles.sectionLabel}>
                      <span>Lesson preview</span>
                      <small>Select a scene or preview a complete path</small>
                    </div>
                    <BranchPreview
                      ref={branchPreviewRef}
                      status={(lastDetailedSnapshot || status) as GlobalStatusDetailedResponse}
                      selectedPathId={activePathId}
                      onPathChange={setActivePathId}
                    />
                  </div>
                )}

                {failed && (
                  <div className={styles.failedPreview}>
                    <BookOpen size={28} />
                    <h2>Lesson generation stopped.</h2>
                    <p>{statusDetail || "TMochiLearn could not complete this interactive lesson."}</p>
                    <div>
                      <button className={styles.secondaryButton} type="button" onClick={newDraft}><RefreshCw size={15} /> Start again</button>
                      {`${statusDetail || ""}`.toLowerCase().includes("credit") && (
                        <button className={styles.primaryButton} type="button" onClick={() => window.location.assign(billingUrl())}><WalletCards size={15} /> Purchase credits</button>
                      )}
                    </div>
                  </div>
                )}

                {complete && defaultOutput && (
                  <div className={styles.completedPreview}>
                    <div className={styles.completedMedia}>
                      <video src={defaultOutput.url} poster={defaultOutput.thumbnail_url} preload="auto" muted playsInline />
                      <span className={styles.completedShade} />
                      <button type="button" onClick={() => setPlayerOpen(true)} aria-label="Play interactive preview">
                        <Play size={24} fill="currentColor" />
                      </button>
                      <div>
                        <span><Check size={13} /> Lesson ready</span>
                        <strong>{outputPaths.length} learning paths</strong>
                      </div>
                    </div>
                    <div className={styles.completedActions}>
                      <button className={styles.primaryButton} type="button" onClick={() => setPlayerOpen(true)}>
                        <Play size={16} fill="currentColor" /> Play interactive lesson
                      </button>
                      <button className={styles.secondaryButton} type="button" onClick={() => void downloadArtifacts()} disabled={downloading}>
                        {downloading ? <LoaderCircle className={styles.spin} size={16} /> : <Download size={16} />}
                        {downloading ? `Packing ${downloadProgress}%` : "Download artifacts"}
                      </button>
                      <button className={styles.publishAction} type="button" onClick={() => setPublishOpen(true)}>
                        <Send size={16} /> Publish to library
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>}
      </div>

      {playerOpen && status && (
        <CompletedPlayer
          status={status}
          onClose={() => setPlayerOpen(false)}
          onPathChange={setActivePathId}
        />
      )}
      {publishOpen && (
        <PublishDialog
          sessionId={requestId}
          suggestedTitle={suggestedTitle(form.prompt)}
          onClose={() => setPublishOpen(false)}
          onCreditsRemaining={(credits) => {
            setUser((current) => ({ ...current, generationCredits: credits }));
          }}
          onInsufficientCredits={() => window.location.assign(billingUrl())}
        />
      )}
    </main>
  );
}
