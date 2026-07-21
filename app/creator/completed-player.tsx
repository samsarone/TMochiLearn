"use client";

import {
  GitBranch,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  GlobalStatusDetailedResponse,
  NarrativeVideoBranchChoiceOption,
  NarrativeVideoBranchChoicePoint,
  NarrativeVideoBranchOutputPath,
} from "samsar-js";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import styles from "./creator.module.css";

export type CompletedPlayerProps = {
  status: GlobalStatusDetailedResponse;
  onClose: () => void;
  onPathChange?: (pathId: string) => void;
};

type IndexedChoice = {
  key: string;
  point: NarrativeVideoBranchChoicePoint;
};

type PendingResume = {
  pathId: string;
  time: number;
  play: boolean;
  volume: number;
};

type BoundaryWatch = {
  video: HTMLVideoElement;
  frameCallbackId?: number;
  audioFadeTimeoutId?: number;
  audioFadeIntervalId?: number;
  previewTimeoutId?: number;
  timeoutId?: number;
};

const MEDIA_WAIT_TIMEOUT_MS = 12_000;
const CHOICE_FADE_LEAD_SECONDS = 0.02;
const CHOICE_AUDIO_FADE_LEAD_SECONDS = 1.25;
const CHOICE_AUDIO_FADE_INTERVAL_MS = 50;
const CHOICE_PROMPT_LEAD_SECONDS = 5;

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
};

const pathDuration = (
  path: NarrativeVideoBranchOutputPath | undefined,
  video?: HTMLVideoElement | null,
  fallback = 0,
) => {
  if (video && Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  if (path?.duration !== undefined && Number.isFinite(path.duration) && path.duration > 0) {
    return path.duration;
  }
  return fallback;
};

const clampMediaTime = (
  value: number,
  path: NarrativeVideoBranchOutputPath | undefined,
  video?: HTMLVideoElement | null,
) => {
  const duration = pathDuration(path, video);
  if (!duration) return Math.max(0, value);
  return Math.min(Math.max(0, value), Math.max(0, duration - 0.01));
};

const leafIdsForOption = (option: NarrativeVideoBranchChoiceOption) =>
  option.leaf_path_ids ?? [];

const choiceKey = (point: NarrativeVideoBranchChoicePoint, index: number) =>
  point.branch_point_id ||
  `choice-${index}-${point.level ?? "level"}-${point.switch_at_seconds ?? "time"}`;

const targetForOption = (
  option: NarrativeVideoBranchChoiceOption,
  paths: NarrativeVideoBranchOutputPath[],
  currentPathId: string,
  defaultPathId: string,
) => {
  const eligibleIds = new Set(leafIdsForOption(option));
  const eligible = paths.filter((path) => eligibleIds.has(path.path_id));
  return (
    eligible.find((path) => path.path_id === currentPathId) ??
    eligible.find((path) => path.path_id === defaultPathId) ??
    eligible.find((path) => path.is_default) ??
    [...eligible].sort((left, right) => (left.ordinal ?? 999) - (right.ordinal ?? 999))[0]
  );
};

export function CompletedPlayer({ status, onClose, onPathChange }: CompletedPlayerProps) {
  const titleId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const pendingResumeRef = useRef<PendingResume | null>(null);
  const switchTimeoutRef = useRef<number | null>(null);
  const boundaryWatchRef = useRef<BoundaryWatch | null>(null);
  const choiceAudioFadeRef = useRef<{
    video: HTMLVideoElement;
    baseVolume: number;
  } | null>(null);
  const presentedChoiceKeyRef = useRef<string | null>(null);
  const preloadedThumbnailUrlsRef = useRef(new Set<string>());

  const branching = status.branching ?? status.session?.branching;
  const paths = useMemo<NarrativeVideoBranchOutputPath[]>(() => {
    if (!branching || branching.outputs.ready !== true) return [];
    return branching.outputs.paths;
  }, [branching]);
  const defaultPathId = branching?.outputs.ready
    ? branching.outputs.default_path_id
    : branching?.default_path_id ?? "";
  const defaultPath = useMemo(
    () =>
      paths.find((path) => path.path_id === defaultPathId) ??
      paths.find((path) => path.is_default) ??
      paths[0],
    [defaultPathId, paths],
  );
  const [activePathId, setActivePathId] = useState(defaultPath?.path_id ?? "");
  const [pendingChoice, setPendingChoice] = useState<IndexedChoice | null>(null);
  const [previewChoice, setPreviewChoice] = useState<IndexedChoice | null>(null);
  const [handledChoices, setHandledChoices] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(pathDuration(defaultPath, null, status.session?.duration));
  const [switching, setSwitching] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const resolvedActivePathId = paths.some((path) => path.path_id === activePathId)
    ? activePathId
    : defaultPath?.path_id ?? "";
  const activePath = paths.find((path) => path.path_id === resolvedActivePathId) ?? defaultPath;
  const activePathIdRef = useRef(resolvedActivePathId);
  const indexedChoices = useMemo<IndexedChoice[]>(
    () =>
      (branching?.tree.choice_points ?? []).map((point, index) => ({
        key: choiceKey(point, index),
        point,
      })),
    [branching],
  );
  const nextChoice = useMemo(
    () =>
      indexedChoices
        .filter(({ key, point }) => {
          if (handledChoices.includes(key) || !Number.isFinite(point.switch_at_seconds)) return false;
          return point.options.some((option) => leafIdsForOption(option).includes(resolvedActivePathId));
        })
        .sort(
          (left, right) =>
            (left.point.switch_at_seconds ?? Number.POSITIVE_INFINITY) -
            (right.point.switch_at_seconds ?? Number.POSITIVE_INFINITY),
        )[0],
    [handledChoices, indexedChoices, resolvedActivePathId],
  );
  const nextChoiceThumbnailUrls = useMemo(() => {
    if (!nextChoice || !defaultPath) return [];

    return [...new Set(nextChoice.point.options.map((option) => {
      const target = targetForOption(
        option,
        paths,
        resolvedActivePathId,
        defaultPath.path_id,
      );
      return target?.thumbnail_url || status.thumbnail_url || "";
    }).filter(Boolean))];
  }, [defaultPath, nextChoice, paths, resolvedActivePathId, status.thumbnail_url]);

  const getActiveVideo = useCallback(
    () => videoRefs.current.get(resolvedActivePathId) ?? null,
    [resolvedActivePathId],
  );

  const clearSwitchTimeout = useCallback(() => {
    if (switchTimeoutRef.current !== null) {
      window.clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }
  }, []);

  const clearBoundaryWatch = useCallback(() => {
    const watch = boundaryWatchRef.current;
    if (!watch) return;
    if (watch.audioFadeTimeoutId !== undefined) window.clearTimeout(watch.audioFadeTimeoutId);
    if (watch.audioFadeIntervalId !== undefined) window.clearInterval(watch.audioFadeIntervalId);
    if (watch.previewTimeoutId !== undefined) window.clearTimeout(watch.previewTimeoutId);
    if (watch.timeoutId !== undefined) window.clearTimeout(watch.timeoutId);
    if (
      watch.frameCallbackId !== undefined &&
      typeof watch.video.cancelVideoFrameCallback === "function"
    ) {
      watch.video.cancelVideoFrameCallback(watch.frameCallbackId);
    }
    boundaryWatchRef.current = null;
  }, []);

  const restoreChoiceAudioVolume = useCallback((video?: HTMLVideoElement | null) => {
    const fade = choiceAudioFadeRef.current;
    if (!fade || (video && fade.video !== video)) return video?.volume ?? 1;
    fade.video.volume = fade.baseVolume;
    choiceAudioFadeRef.current = null;
    return fade.baseVolume;
  }, []);

  const updateChoiceAudioFade = useCallback((
    video: HTMLVideoElement,
    switchAt: number,
    mediaTime: number,
  ) => {
    const secondsRemaining = switchAt - mediaTime;
    if (secondsRemaining > CHOICE_AUDIO_FADE_LEAD_SECONDS) {
      restoreChoiceAudioVolume(video);
      return;
    }

    let fade = choiceAudioFadeRef.current;
    if (fade?.video !== video) {
      restoreChoiceAudioVolume();
      fade = { video, baseVolume: video.volume };
      choiceAudioFadeRef.current = fade;
    }

    const fadeDuration = Math.min(
      CHOICE_AUDIO_FADE_LEAD_SECONDS,
      Math.max(0.01, switchAt),
    );
    const fadeProgress = Math.max(
      0,
      Math.min(1, secondsRemaining / fadeDuration),
    );
    video.volume = fade.baseVolume * fadeProgress;
  }, [restoreChoiceAudioVolume]);

  const showMediaError = useCallback(
    (message: string, video?: HTMLVideoElement | null) => {
      clearSwitchTimeout();
      video?.pause();
      pendingResumeRef.current = null;
      setPlaying(false);
      setSwitching(false);
      setMediaError(message);
    },
    [clearSwitchTimeout],
  );

  const beginMediaWait = useCallback(
    (pathId: string, video?: HTMLVideoElement | null) => {
      clearSwitchTimeout();
      switchTimeoutRef.current = window.setTimeout(() => {
        if (activePathIdRef.current !== pathId) return;
        showMediaError(
          "This branch took too long to load. Retry it or replay the session.",
          video,
        );
      }, MEDIA_WAIT_TIMEOUT_MS);
    },
    [clearSwitchTimeout, showMediaError],
  );

  const playVideo = useCallback(async (video: HTMLVideoElement) => {
    const pathId = video.dataset.pathId || activePathIdRef.current;
    setMediaError(null);
    beginMediaWait(pathId, video);
    try {
      await video.play();
      setHasStarted(true);
      setPlaying(true);
    } catch {
      showMediaError(
        "Playback could not start. Retry the branch or replay the session.",
        video,
      );
    }
  }, [beginMediaWait, showMediaError]);

  const playActive = useCallback(async () => {
    if (pendingChoice) return;
    const video = getActiveVideo();
    if (!video) return;
    await playVideo(video);
  }, [getActiveVideo, pendingChoice, playVideo]);

  const togglePlay = useCallback(async () => {
    const video = getActiveVideo();
    if (!video || pendingChoice) return;
    if (video.paused) await playVideo(video);
    else video.pause();
  }, [getActiveVideo, pendingChoice, playVideo]);

  useEffect(() => {
    activePathIdRef.current = resolvedActivePathId;
    if (resolvedActivePathId) onPathChange?.(resolvedActivePathId);
  }, [onPathChange, resolvedActivePathId]);

  useEffect(
    () => () => {
      clearBoundaryWatch();
      clearSwitchTimeout();
      restoreChoiceAudioVolume();
    },
    [clearBoundaryWatch, clearSwitchTimeout, restoreChoiceAudioVolume],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === " " && !event.repeat) {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) {
          return;
        }
        event.preventDefault();
        void togglePlay();
      }
    };
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [onClose, togglePlay]);

  const syncAndPlay = (
    target: NarrativeVideoBranchOutputPath,
    mediaTime: number,
    shouldPlay: boolean,
    volume = 1,
  ) => {
    const video = videoRefs.current.get(target.path_id);
    setMediaError(null);
    setCurrentTime(mediaTime);
    setDuration(pathDuration(target, video, status.session?.duration));
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      pendingResumeRef.current = {
        pathId: target.path_id,
        time: mediaTime,
        play: shouldPlay,
        volume,
      };
      if (shouldPlay) beginMediaWait(target.path_id, video);
      video?.load();
      return;
    }
    video.volume = volume;
    video.currentTime = clampMediaTime(mediaTime, target, video);
    if (shouldPlay) void playVideo(video);
    else setSwitching(false);
  };

  const chooseBranch = (option: NarrativeVideoBranchChoiceOption) => {
    if (!pendingChoice || !defaultPath) return;
    const sourceVideo = getActiveVideo();
    const target = targetForOption(option, paths, resolvedActivePathId, defaultPath.path_id);
    if (!target) return;

    const switchAt = pendingChoice.point.switch_at_seconds;
    const mediaTime = Number.isFinite(switchAt) ? Math.max(0, switchAt ?? 0) : sourceVideo?.currentTime ?? currentTime;
    const resumeVolume = restoreChoiceAudioVolume(sourceVideo);
    sourceVideo?.pause();
    clearBoundaryWatch();
    presentedChoiceKeyRef.current = null;
    setHandledChoices((previous) =>
      previous.includes(pendingChoice.key) ? previous : [...previous, pendingChoice.key],
    );
    setPendingChoice(null);
    setPreviewChoice(null);
    setSwitching(target.path_id !== resolvedActivePathId);
    setActivePathId(target.path_id);
    syncAndPlay(target, mediaTime, true, resumeVolume);
  };

  const replay = () => {
    if (!defaultPath) return;
    const replayVolume = restoreChoiceAudioVolume(getActiveVideo());
    videoRefs.current.forEach((video) => video.pause());
    clearBoundaryWatch();
    clearSwitchTimeout();
    pendingResumeRef.current = null;
    presentedChoiceKeyRef.current = null;
    setHandledChoices([]);
    setPendingChoice(null);
    setPreviewChoice(null);
    setMediaError(null);
    setSwitching(defaultPath.path_id !== resolvedActivePathId);
    setActivePathId(defaultPath.path_id);
    setHasStarted(true);
    syncAndPlay(defaultPath, 0, true, replayVolume);
  };

  const seek = (mediaTime: number) => {
    if (pendingChoice) return;
    const video = getActiveVideo();
    if (!video) return;
    const targetTime = clampMediaTime(mediaTime, activePath, video);
    video.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const toggleMute = () => setMuted((value) => !value);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (stageRef.current?.requestFullscreen) void stageRef.current.requestFullscreen();
  };

  const handleLoadedMetadata = (
    video: HTMLVideoElement,
    path: NarrativeVideoBranchOutputPath,
  ) => {
    if (path.path_id === resolvedActivePathId) {
      setDuration(pathDuration(path, video, status.session?.duration));
    }
    const pendingResume = pendingResumeRef.current;
    if (pendingResume?.pathId !== path.path_id) return;
    video.volume = pendingResume.volume;
    video.currentTime = clampMediaTime(pendingResume.time, path, video);
    pendingResumeRef.current = null;
    if (pendingResume.play) void playVideo(video);
    else setSwitching(false);
  };

  const presentChoiceAtBoundary = useCallback(
    (video: HTMLVideoElement, pathId: string, choice: IndexedChoice) => {
      if (
        pathId !== activePathIdRef.current ||
        presentedChoiceKeyRef.current === choice.key
      ) {
        return;
      }
      const switchAt = choice.point.switch_at_seconds;
      if (switchAt === undefined || !Number.isFinite(switchAt)) return;

      presentedChoiceKeyRef.current = choice.key;
      clearBoundaryWatch();
      clearSwitchTimeout();
      updateChoiceAudioFade(video, switchAt, switchAt);
      video.pause();
      video.currentTime = clampMediaTime(switchAt, activePath, video);
      setCurrentTime(switchAt);
      setPreviewChoice(choice);
      setPendingChoice(choice);
      setSwitching(false);
    },
    [activePath, clearBoundaryWatch, clearSwitchTimeout, updateChoiceAudioFade],
  );

  useEffect(() => {
    clearBoundaryWatch();
    if (!playing || pendingChoice || !nextChoice || mediaError) return;

    const video = videoRefs.current.get(resolvedActivePathId);
    const switchAt = nextChoice.point.switch_at_seconds;
    if (!video || switchAt === undefined || !Number.isFinite(switchAt)) return;

    const watch: BoundaryWatch = { video };
    boundaryWatchRef.current = watch;
    const audioFadeAt = Math.max(0, switchAt - CHOICE_AUDIO_FADE_LEAD_SECONDS);
    const previewAt = Math.max(0, switchAt - CHOICE_FADE_LEAD_SECONDS);
    const fadeAudio = () => {
      if (
        boundaryWatchRef.current !== watch ||
        video.paused ||
        activePathIdRef.current !== resolvedActivePathId
      ) {
        return;
      }
      updateChoiceAudioFade(video, switchAt, video.currentTime);
    };
    const startAudioFade = () => {
      fadeAudio();
      if (boundaryWatchRef.current !== watch) return;
      watch.audioFadeIntervalId = window.setInterval(
        fadeAudio,
        CHOICE_AUDIO_FADE_INTERVAL_MS,
      );
    };
    const showPreview = () => {
      if (
        boundaryWatchRef.current !== watch ||
        video.paused ||
        activePathIdRef.current !== resolvedActivePathId
      ) {
        return;
      }
      setPreviewChoice(nextChoice);
    };
    const stopAtBoundary = () => {
      if (
        boundaryWatchRef.current !== watch ||
        video.paused ||
        activePathIdRef.current !== resolvedActivePathId
      ) {
        return;
      }
      presentChoiceAtBoundary(video, resolvedActivePathId, nextChoice);
    };

    const remainingSeconds = Math.max(0, switchAt - video.currentTime);
    const audioFadeRemainingSeconds = Math.max(0, audioFadeAt - video.currentTime);
    const previewRemainingSeconds = Math.max(0, previewAt - video.currentTime);
    watch.audioFadeTimeoutId = window.setTimeout(
      startAudioFade,
      (audioFadeRemainingSeconds / Math.max(0.1, video.playbackRate)) * 1_000,
    );
    watch.previewTimeoutId = window.setTimeout(
      showPreview,
      (previewRemainingSeconds / Math.max(0.1, video.playbackRate)) * 1_000,
    );
    watch.timeoutId = window.setTimeout(
      stopAtBoundary,
      (remainingSeconds / Math.max(0.1, video.playbackRate)) * 1_000,
    );

    if (typeof video.requestVideoFrameCallback === "function") {
      const inspectFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (boundaryWatchRef.current !== watch) return;
        const mediaTime = Math.max(metadata.mediaTime, video.currentTime);
        if (mediaTime >= audioFadeAt) updateChoiceAudioFade(video, switchAt, mediaTime);
        if (mediaTime >= switchAt) {
          stopAtBoundary();
          return;
        }
        if (mediaTime >= previewAt) showPreview();
        watch.frameCallbackId = video.requestVideoFrameCallback(inspectFrame);
      };
      watch.frameCallbackId = video.requestVideoFrameCallback(inspectFrame);
    }

    return clearBoundaryWatch;
  }, [
    clearBoundaryWatch,
    currentTime,
    mediaError,
    nextChoice,
    pendingChoice,
    playing,
    presentChoiceAtBoundary,
    resolvedActivePathId,
    updateChoiceAudioFade,
  ]);

  useEffect(() => {
    const switchAt = nextChoice?.point.switch_at_seconds;
    if (
      switchAt === undefined ||
      !Number.isFinite(switchAt) ||
      switchAt - currentTime > CHOICE_PROMPT_LEAD_SECONDS
    ) {
      return;
    }

    nextChoiceThumbnailUrls.forEach((url) => {
      if (preloadedThumbnailUrlsRef.current.has(url)) return;
      preloadedThumbnailUrlsRef.current.add(url);

      const image = new Image();
      image.decoding = "async";
      image.src = url;
      if (typeof image.decode === "function") {
        void image.decode().catch(() => undefined);
      }
    });
  }, [currentTime, nextChoice, nextChoiceThumbnailUrls]);

  const handleTimeUpdate = (video: HTMLVideoElement, pathId: string) => {
    if (pathId !== resolvedActivePathId) return;
    const mediaTime = video.currentTime;
    setCurrentTime(mediaTime);
    if (!nextChoice || pendingChoice) return;
    const switchAt = nextChoice.point.switch_at_seconds;
    if (switchAt === undefined || !Number.isFinite(switchAt)) return;
    updateChoiceAudioFade(video, switchAt, mediaTime);
    if (mediaTime >= switchAt - CHOICE_FADE_LEAD_SECONDS) setPreviewChoice(nextChoice);
    if (mediaTime < switchAt) return;
    presentChoiceAtBoundary(video, pathId, nextChoice);
  };

  const retryActivePath = () => {
    if (!activePath) return;
    const video = getActiveVideo();
    const retryVolume = restoreChoiceAudioVolume(video);
    setMediaError(null);
    setSwitching(true);
    pendingResumeRef.current = {
      pathId: activePath.path_id,
      time: currentTime,
      play: true,
      volume: retryVolume,
    };
    beginMediaWait(activePath.path_id, video);
    video?.load();
  };

  if (!branching || branching.outputs.ready !== true || !defaultPath || paths.length === 0) {
    return (
      <div
        className={styles.playerModal}
        role="presentation"
        onMouseDown={(event) => event.currentTarget === event.target && onClose()}
      >
        <section className={styles.playerStage} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className={styles.playerTopbar}>
            <span id={titleId}>Interactive preview</span>
            <button type="button" onClick={onClose} aria-label="Close preview"><X size={20} /></button>
          </div>
          <div className={styles.playerStart}>
            <GitBranch size={28} />
            <strong>This interactive render is not ready yet.</strong>
          </div>
        </section>
      </div>
    );
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const activeLabel = activePath?.branching_hint || activePath?.path_id || "Interactive path";
  const displayedChoice = pendingChoice ?? previewChoice;
  const secondsUntilChoice = nextChoice?.point.switch_at_seconds !== undefined
    ? nextChoice.point.switch_at_seconds - currentTime
    : Number.POSITIVE_INFINITY;
  const showChoicePrompt = Boolean(
    playing &&
    nextChoice &&
    !displayedChoice &&
    secondsUntilChoice <= CHOICE_PROMPT_LEAD_SECONDS &&
    secondsUntilChoice > CHOICE_FADE_LEAD_SECONDS,
  );

  return (
    <div
      className={styles.playerModal}
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className={styles.playerStage}
        ref={stageRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.playerTopbar}>
          <div>
            <GitBranch size={15} />
            <span id={titleId}>Interactive session preview</span>
            <strong>{activeLabel}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close preview">
            <X size={20} />
          </button>
        </div>

        {paths.map((path) => {
          const isActive = path.path_id === resolvedActivePathId;
          return (
            <video
              key={path.path_id}
              ref={(element) => {
                if (element) videoRefs.current.set(path.path_id, element);
                else videoRefs.current.delete(path.path_id);
              }}
              className={styles.playerVideo}
              style={{
                opacity: isActive ? 1 : 0,
                pointerEvents: isActive ? "auto" : "none",
                visibility: isActive ? "visible" : "hidden",
                zIndex: isActive ? 1 : 0,
              }}
              data-path-id={path.path_id}
              src={path.url}
              poster={path.thumbnail_url || (isActive ? status.thumbnail_url ?? undefined : undefined)}
              preload={isActive ? "auto" : "none"}
              playsInline
              muted={muted}
              tabIndex={isActive ? 0 : -1}
              aria-hidden={!isActive}
              onClick={isActive ? () => void togglePlay() : undefined}
              onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget, path)}
              onDurationChange={isActive ? (event) => setDuration(pathDuration(path, event.currentTarget)) : undefined}
              onTimeUpdate={isActive ? (event) => handleTimeUpdate(event.currentTarget, path.path_id) : undefined}
              onPlay={() => {
                if (isActive) {
                  setPlaying(true);
                  setHasStarted(true);
                }
              }}
              onPlaying={() => {
                if (isActive) {
                  clearSwitchTimeout();
                  setSwitching(false);
                  setMediaError(null);
                }
              }}
              onPause={() => {
                if (isActive) {
                  setPlaying(false);
                  if (!presentedChoiceKeyRef.current) setPreviewChoice(null);
                }
              }}
              onEnded={() => isActive && setPlaying(false)}
              onError={(event) => {
                if (isActive) {
                  showMediaError(
                    "This branch could not be loaded. Retry it or replay the session.",
                    event.currentTarget,
                  );
                }
              }}
            />
          );
        })}

        {!hasStarted && !pendingChoice && !mediaError && (
          <div className={styles.playerStart}>
            <button type="button" onClick={() => void playActive()} aria-label="Play interactive preview">
              <Play size={30} fill="currentColor" />
            </button>
            <span>Play interactive preview</span>
          </div>
        )}

        {switching && (
          <div className={styles.playerStart} aria-live="polite">
            <GitBranch size={24} />
            <span>Switching path…</span>
          </div>
        )}

        {mediaError && (
          <div className={styles.playerStart} role="alert">
            <strong>Preview interrupted</strong>
            <span>{mediaError}</span>
            <button type="button" onClick={retryActivePath} aria-label="Retry this branch">
              <RotateCcw size={25} />
            </button>
          </div>
        )}

        {showChoicePrompt && (
          <div className={styles.playerChoicePrompt} role="status">
            <GitBranch size={14} />
            <span>Choose the next path</span>
          </div>
        )}

        {displayedChoice && (
          <div
            className={`${styles.playerChoiceOverlay} ${pendingChoice ? styles.playerChoiceReady : styles.playerChoicePreviewing}`}
            aria-hidden={!pendingChoice}
          >
            <div>
              <span>Choice point {displayedChoice.point.level ? `· Level ${displayedChoice.point.level}` : ""}</span>
              <h2>What should the learner explore next?</h2>
            </div>
            <div
              className={styles.playerChoiceGrid}
              style={{ "--choice-count": displayedChoice.point.options.length } as CSSProperties}
            >
              {displayedChoice.point.options.map((option, index) => {
                const target = targetForOption(option, paths, resolvedActivePathId, defaultPath.path_id);
                const title = option.path_name || target?.branching_hint || `Path ${index + 1}`;
                const description =
                  option.path_description ||
                  target?.branching_description ||
                  "Continue along this branch.";
                const thumbnail = target?.thumbnail_url || status.thumbnail_url || "";
                return (
                  <button
                    className={styles.playerChoice}
                    type="button"
                    key={`${displayedChoice.key}-${option.child_node_id ?? index}`}
                    onClick={() => chooseBranch(option)}
                    disabled={!target || !pendingChoice}
                    aria-label={`Choose ${title}`}
                  >
                    {thumbnail ? (
                      // Branch thumbnails are arbitrary render URLs and should not require
                      // every generation host to be added to the Next Image allowlist.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.playerChoiceImage} src={thumbnail} alt="" />
                    ) : (
                      <span className={styles.playerChoiceImage} aria-hidden="true" />
                    )}
                    <span className={styles.playerChoiceCopy}>
                      <strong>{title}</strong>
                      <span>{description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.playerControls}>
          <div>
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.05}
              value={Math.min(currentTime, duration || 1)}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={Boolean(pendingChoice || mediaError)}
              aria-label="Preview timeline"
              style={{ "--progress": `${progress}%` } as CSSProperties}
            />
            <span>{formatTime(duration)}</span>
          </div>
          <div>
            <div>
              <button type="button" onClick={() => void togglePlay()} disabled={Boolean(pendingChoice || mediaError)} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
              </button>
              <button type="button" onClick={replay} aria-label="Replay from the beginning">
                <RotateCcw size={18} />
              </button>
              <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
            </div>
            <span><GitBranch size={14} /> {activeLabel}</span>
            <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
              {fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CompletedPlayer;
