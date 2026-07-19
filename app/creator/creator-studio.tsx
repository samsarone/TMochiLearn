"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  Film,
  GitBranch,
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
import { BranchPreview } from "./branch-preview";
import { BranchTree } from "./branch-tree";
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
  version: 2;
  form: CreatorForm;
  pendingSubmission?: PendingGenerationSubmission;
};

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_BACKOFF_MS = 60_000;
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
  if (!hasRequest) return "Ready for direction";
  if (!status) return "Connecting to the render graph";
  if (isCompleted(status)) return "Interactive render complete";
  if (isFailed(status)) return "Generation stopped";
  const sessionStage = status.session?.currentStage || status.session?.previewStage;
  const stage = String(sessionStage || "").toLowerCase();
  if (stage.includes("frame")) return "Rendering branch frames";
  if (stage.includes("video")) return "Encoding branch films";
  if (stage.includes("audio") || stage.includes("speech")) return "Building spatial audio";
  if (getBranching(status)?.paths?.length) return "Materializing the branch tree";
  return "Writing the interactive narrative";
}

function resolveProgress(status: CreatorStatus | null) {
  if (isCompleted(status)) return 100;
  const summary = getBranching(status)?.summary;
  if (Number.isFinite(Number(summary?.progress_percent))) {
    return Math.min(99, Math.max(2, Number(summary?.progress_percent)));
  }
  if (status?.session?.layers?.length) return 28;
  return status ? 9 : 3;
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
  const firstSentence = prompt.trim().split(/[.!?\n]/)[0]?.trim() || "Untitled interactive film";
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
    duration: Math.min(240, Math.max(10, Number(stored.duration))),
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
}: {
  initialUser: CreatorUser;
  initialSessionId?: string;
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [form, setForm] = useState<CreatorForm>({
    prompt: "",
    duration: 30,
    imageModel: "NANOBANANA2",
    videoModel: "COSMOS3SUPERI2V",
    levels: 2,
  });
  const [requestId, setRequestId] = useState(initialSessionId.trim());
  const [status, setStatus] = useState<CreatorStatus | null>(null);
  const [lastDetailedSnapshot, setLastDetailedSnapshot] = useState<CreatorStatus | null>(null);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const latestRequestRef = useRef("");
  const pendingSubmissionRef = useRef<PendingGenerationSubmission | null>(null);
  const storageScope = initialUser.id || initialUser.email || initialUser.username || "creator";
  const creatorStorageKey = `${CREATOR_REQUEST_STORAGE_KEY}:${storageScope}`;

  const estimatedCredits = useMemo(
    () => estimateInteractiveCredits(form.duration, form.levels, form.videoModel),
    [form.duration, form.levels, form.videoModel],
  );
  const branching = getBranching(status) ?? getBranching(lastDetailedSnapshot);
  const complete = isCompleted(status);
  const failed = isFailed(status);
  const inProgress = Boolean(requestId) && !complete && !failed;
  const progress = resolveProgress(status);
  const stage = resolveStage(status, Boolean(requestId));
  const creditsCharged = resolveCreditsCharged(status);
  const balanceMayBeShort = !requestId && user.generationCredits < estimatedCredits;

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
    // Remove legacy/unscoped records; the route is now the canonical session ID.
    window.localStorage.removeItem("tmochi.creator.request-id.v1");
    window.localStorage.removeItem(CREATOR_REQUEST_STORAGE_KEY);
    const raw = window.localStorage.getItem(creatorStorageKey)?.trim();
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<StoredCreatorState>;
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
        if (savedForm) setForm(savedForm);
        pendingSubmissionRef.current = savedPending;
      }, 0);
    } catch {
      window.localStorage.removeItem(creatorStorageKey);
    }
  }, [creatorStorageKey]);

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
          setError(permanentMessage);
          setPolling(false);
          return;
        }
        if (!response.ok || !next) {
          throw new Error(next?.error || "The render status is temporarily unavailable.");
        }
        if (disposed || latestRequestRef.current !== requestId) return;

        consecutiveErrors = 0;
        setStatus(next);
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
        setForm((current) => ({
          prompt:
            typeof nextPrompt === "string" && nextPrompt.trim()
              ? nextPrompt
              : current.prompt,
          duration: Number.isFinite(Number(nextDuration))
            ? Math.min(240, Math.max(10, Number(nextDuration)))
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
        }));
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

        const terminal = isCompleted(next) || isFailed(next);
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
  }, [refreshUser, requestId]);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.prompt.trim()) {
      setError("Describe the story you want to create.");
      return;
    }
    if (user.generationCredits <= 0) {
      window.location.assign(billingUrl());
      return;
    }

    setGenerating(true);
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
        version: 2,
        form,
        pendingSubmission: pendingSubmissionRef.current,
      } satisfies StoredCreatorState));
      const response = await fetch("/api/creator/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...generationPayload,
          client_request_id: clientRequestId,
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
          version: 2,
          form,
        } satisfies StoredCreatorState));
        window.location.assign(billingUrl());
        return;
      }
      if (!response.ok) {
        const generationMessage = result?.error || "Unable to start this generation.";
        if (
          generationMessage.toLowerCase().includes("insufficient") &&
          generationMessage.toLowerCase().includes("credit")
        ) {
          pendingSubmissionRef.current = null;
          window.localStorage.setItem(creatorStorageKey, JSON.stringify({
            version: 2,
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
            version: 2,
            form,
          } satisfies StoredCreatorState));
        }
        throw new Error(generationMessage);
      }
      const nextRequestId = result?.request_id || result?.session_id || "";
      if (!nextRequestId) throw new Error("Samsar did not return a render request ID.");
      pendingSubmissionRef.current = null;
      window.localStorage.setItem(creatorStorageKey, JSON.stringify({
        version: 2,
        form,
      } satisfies StoredCreatorState));
      setRequestId(nextRequestId);
      router.replace(`/creator/${encodeURIComponent(nextRequestId)}`, { scroll: false });
      if (typeof result?.creditsRemaining === "number") {
        setUser((current) => ({ ...current, generationCredits: result.creditsRemaining as number }));
      }
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Unable to start this generation.");
    } finally {
      setGenerating(false);
    }
  }

  function newDraft() {
    window.localStorage.removeItem(creatorStorageKey);
    pendingSubmissionRef.current = null;
    setRequestId("");
    setStatus(null);
    setLastDetailedSnapshot(null);
    setActivePathId(null);
    setError(null);
    setPlayerOpen(false);
    setPublishOpen(false);
    router.push("/creator");
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
            "tMochi interactive video artifacts\n\n" +
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
      anchor.download = `tmochi-${sanitizeFileName(requestId)}-artifacts.zip`;
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
          <Link className={styles.headerBrand} href="/" aria-label="tMochi home"><CreatorBrand /></Link>
          <span className={styles.headerDivider} />
          <div>
            <strong>Creator Studio</strong>
            <span>Interactive cinema engine</span>
          </div>
        </div>
        <div className={styles.creditCluster}>
          <div className={`${styles.estimateCard} ${balanceMayBeShort ? styles.estimateWarning : ""}`}>
            <span><Zap size={13} /> {requestId ? (complete ? "Credits charged" : "Charged so far") : "Estimated up to"}</span>
            <strong>{numberFormatter.format(requestId && creditsCharged !== null ? creditsCharged : estimatedCredits)} credits</strong>
          </div>
          <div className={styles.balanceCard}>
            <span>Available balance</span>
            <strong>{numberFormatter.format(user.generationCredits)}</strong>
          </div>
          <button className={styles.purchaseButton} type="button" onClick={() => window.location.assign(billingUrl())}>
            <WalletCards size={15} /> Purchase credits
          </button>
          <div className={styles.userMenu} title={user.email || user.displayName}>
            {user.avatarUrl ? (
              // Remote account avatars can come from multiple identity providers.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" />
            ) : <span>{user.displayName.slice(0, 1).toUpperCase()}</span>}
            <button type="button" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </header>

      <div className={styles.studioGrid}>
        <aside className={styles.controlPanel}>
          <div className={styles.panelHeading}>
            <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Public feed</Link>
            <span className={styles.eyebrow}>Build a new transmission</span>
            <h1>Direct every<br /><em>possible path.</em></h1>
            <p>Describe one premise. tMochi builds its story tree, renders every branch, and keeps the timing connected.</p>
          </div>

          <form className={styles.creatorForm} onSubmit={generate}>
            <label className={styles.promptField}>
              <span>Story direction <small>{form.prompt.length}/4,000</small></span>
              <textarea
                value={form.prompt}
                onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                maxLength={4000}
                rows={7}
                placeholder="A midnight train arrives in a sleeping city. The viewer chooses which stranger to follow…"
                disabled={inProgress || generating}
                required
              />
            </label>

            <div className={styles.durationField}>
              <div className={styles.fieldTitle}>
                <span>Duration</span>
                <label>
                  <input
                    type="number"
                    min={10}
                    max={240}
                    value={form.duration}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      duration: Math.min(240, Math.max(10, Number(event.target.value) || 10)),
                    }))}
                    disabled={inProgress || generating}
                    aria-label="Duration in seconds"
                  />
                  <span>sec</span>
                </label>
              </div>
              <input
                type="range"
                min={10}
                max={240}
                step={5}
                value={form.duration}
                onChange={(event) => setForm((current) => ({ ...current, duration: Number(event.target.value) }))}
                disabled={inProgress || generating}
                style={{ "--range-progress": `${((form.duration - 10) / 230) * 100}%` } as React.CSSProperties}
                aria-label="Select duration"
              />
              <div className={styles.rangeTicks}><span>10s</span><span>4 min</span></div>
            </div>

            <div className={styles.selectGrid}>
              <label>
                <span>Image model</span>
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
                <small>{IMAGE_MODELS.find((model) => model.value === form.imageModel)?.detail}</small>
              </label>
              <label>
                <span>Video model</span>
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
                <small>{VIDEO_MODELS.find((model) => model.value === form.videoModel)?.detail}</small>
              </label>
            </div>

            <fieldset className={styles.levelField} disabled={inProgress || generating}>
              <legend>
                <span>Branching levels</span>
                <small>{Math.pow(2, form.levels)} possible endings</small>
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
                    <span>{Math.pow(2, level)} paths</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <div className={styles.formError} role="alert">{error}</div>}
            {balanceMayBeShort && !inProgress && (
              <div className={styles.creditWarning}>
                <CircleDollarSign size={16} />
                <span>Your balance is below the conservative ceiling. The final charge may be lower because shared branch media is billed once.</span>
              </div>
            )}

            {!requestId ? (
              <button className={styles.generateButton} type="submit" disabled={generating || !form.prompt.trim()}>
                {generating ? <LoaderCircle className={styles.spin} size={18} /> : <Sparkles size={18} />}
                <span>{generating ? "Opening render graph" : "Generate interactive film"}</span>
                {!generating && <Zap size={15} />}
              </button>
            ) : (
              <div className={styles.activeRequestActions}>
                <button className={styles.secondaryButton} type="button" onClick={newDraft} disabled={inProgress}>
                  <Plus size={15} /> New draft
                </button>
                {inProgress && <span><LoaderCircle className={styles.spin} size={13} /> Generation locked while rendering</span>}
              </div>
            )}
            <p className={styles.estimateNote}>Estimate uses the selected model’s full rate and assumes every leaf spans the maximum duration. The API charges the exact unique branch duration.</p>
          </form>
        </aside>

        <section className={styles.previewPanel} aria-label="Interactive video preview">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.statusDot} data-state={complete ? "complete" : failed ? "failed" : requestId ? "active" : "idle"} />
              <div>
                <strong>{stage}</strong>
                <span>{requestId ? `Session ${requestId.slice(0, 8)}…` : "No active session"}</span>
              </div>
            </div>
            {requestId && (
              <div className={styles.progressReadout}>
                <span>{polling && !complete && !failed ? "Live status" : complete ? "Ready" : failed ? "Stopped" : "Syncing"}</span>
                <strong>{Math.round(progress)}%</strong>
              </div>
            )}
          </div>

          {requestId && (
            <div className={styles.progressTrack} aria-label={`${Math.round(progress)} percent complete`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className={styles.previewBody}>
            {!requestId && (
              <div className={styles.emptyPreview}>
                <div className={styles.emptyOrbit} aria-hidden="true">
                  <span /><span /><span />
                  <GitBranch size={30} />
                </div>
                <span className={styles.eyebrow}>Session preview</span>
                <h2>Your story tree will grow here.</h2>
                <p>As scenes finish, preview a random path through the live render. Once complete, play the real interactive cut before publishing.</p>
                <div className={styles.emptySteps}>
                  <span><strong>01</strong> Narrative</span>
                  <span><strong>02</strong> Branches</span>
                  <span><strong>03</strong> Interactive render</span>
                </div>
              </div>
            )}

            {requestId && (
              <>
                <div className={styles.treeSection}>
                  <div className={styles.sectionLabel}>
                    <span>Branch topology</span>
                    <small>{branching?.tree.num_levels ? `${branching.tree.num_levels} levels` : "Mapping story graph"}</small>
                  </div>
                  <BranchTree branching={branching} activePathId={activePathId} />
                </div>

                {!complete && !failed && (
                  <div className={styles.livePreviewSection}>
                    <div className={styles.sectionLabel}>
                      <span>Random path preview</span>
                      <small>Each run selects one available ending</small>
                    </div>
                    <BranchPreview
                      status={(lastDetailedSnapshot || status) as GlobalStatusDetailedResponse}
                      selectedPathId={activePathId}
                      onPathChange={setActivePathId}
                    />
                  </div>
                )}

                {failed && (
                  <div className={styles.failedPreview}>
                    <Film size={28} />
                    <h2>This generation stopped.</h2>
                    <p>{statusDetail || "The renderer could not complete this interactive film."}</p>
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
                      <video src={defaultOutput.url} poster={defaultOutput.thumbnail_url} preload="metadata" muted playsInline />
                      <span className={styles.completedShade} />
                      <button type="button" onClick={() => setPlayerOpen(true)} aria-label="Play interactive preview">
                        <Play size={24} fill="currentColor" />
                      </button>
                      <div>
                        <span><Check size={13} /> Render complete</span>
                        <strong>{outputPaths.length} playable paths</strong>
                      </div>
                    </div>
                    <div className={styles.completedActions}>
                      <button className={styles.primaryButton} type="button" onClick={() => setPlayerOpen(true)}>
                        <Play size={16} fill="currentColor" /> Play interactive cut
                      </button>
                      <button className={styles.secondaryButton} type="button" onClick={() => void downloadArtifacts()} disabled={downloading}>
                        {downloading ? <LoaderCircle className={styles.spin} size={16} /> : <Download size={16} />}
                        {downloading ? `Packing ${downloadProgress}%` : "Download artifacts"}
                      </button>
                      <button className={styles.publishAction} type="button" onClick={() => setPublishOpen(true)}>
                        <Send size={16} /> Publish to feed
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
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
        />
      )}
    </main>
  );
}
