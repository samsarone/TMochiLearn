"use client";

import {
  BookOpen,
  ChevronDown,
  Expand,
  Film,
  GitFork,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Redo2,
  Undo2,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  InteractivePublication,
  InteractivePublicationChoiceOption,
  InteractivePublicationChoicePoint,
  InteractivePublicationVideoPath,
} from "samsar-js";
import Link from "next/link";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import { TmochiLogo } from "../components/tmochi-logo";

type PublicationResponse = {
  items: CatalogPublication[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
};

type CatalogPublication = InteractivePublication & {
  categories?: string[];
  topics?: string[];
};

type PublicationDetailResponse = {
  publication: InteractivePublication;
};

type PlayerEntry = "internal" | "direct";

type InteractivePlayerHandle = {
  playWithSound: () => Promise<void>;
};

type ChoiceTransitionWatch = {
  video: HTMLVideoElement;
  audioFadeTimeoutId?: number;
  audioFadeIntervalId?: number;
  previewTimeoutId?: number;
  boundaryTimeoutId?: number;
  frameCallbackId?: number;
};

const CHOICE_FADE_LEAD_SECONDS = 0.02;
const CHOICE_AUDIO_FADE_LEAD_SECONDS = 1.25;
const CHOICE_AUDIO_FADE_INTERVAL_MS = 50;
const CHOICE_PROMPT_LEAD_SECONDS = 5;
const MOBILE_PLAYER_MEDIA_QUERY =
  "(max-width: 767px), (max-width: 1024px) and (pointer: coarse)";

const useMobilePlayerLoading = () => {
  // Start conservatively so mobile browsers cannot begin fetching branch videos
  // from the server-rendered markup before React has detected the viewport.
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_PLAYER_MEDIA_QUERY);
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMobile;
};

const publicationPath = (publicationId: string) =>
  `/watch/${encodeURIComponent(publicationId)}`;

const publicationIdFromLocation = () => {
  const match = window.location.pathname.match(/^\/watch\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

const demoPublication: CatalogPublication = {
  id: "tmochi-demo",
  type: "InteractiveVideo",
  schema: "interactive_publication.v1",
  title: "Signal / Noise",
  description:
    "A live player prototype. Follow the signal or leave the known path when the transmission fractures.",
  tags: ["sci-fi", "prototype"],
  categories: ["Film & Animation"],
  topics: ["interactive storytelling", "science fiction"],
  creatorHandle: "tMochi",
  datePublished: "2026-07-19T00:00:00.000Z",
  mainVideoUrl:
    "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  mainThumbnailUrl:
    "https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerEscapes.jpg",
  thumbnailUrl:
    "https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerEscapes.jpg",
  duration: 15,
  aspectRatio: "16:9",
  inLanguage: "en",
  hasSubtitles: false,
  manifest: {
    schema: "interactive_video_manifest.v1",
    default_path_id: "signal",
    timing: { origin: "media", unit: "seconds" },
    tree: {
      root_node_id: "root",
      choice_points: [
        {
          branch_point_id: "first-contact",
          parent_node_id: "root",
          level: 1,
          switch_at_seconds: 5,
          options: [
            {
              child_node_id: "signal",
              branch_ordinal: 1,
              branching_hint: "Follow the signal",
              description: "Stay with the transmission.",
              leaf_path_ids: ["signal"],
            },
            {
              child_node_id: "escape",
              branch_ordinal: 2,
              branching_hint: "Break away",
              description: "Leave the known frequency.",
              leaf_path_ids: ["escape"],
            },
          ],
        },
      ],
    },
    outputs: {
      paths: [
        {
          path_id: "signal",
          contentUrl:
            "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
          thumbnailUrl:
            "https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerEscapes.jpg",
          encodingFormat: "video/mp4",
          duration: 15,
          is_default: true,
        },
        {
          path_id: "escape",
          contentUrl:
            "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
          thumbnailUrl:
            "https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg",
          encodingFormat: "video/mp4",
          duration: 15,
          is_default: false,
        },
      ],
    },
  },
};

const learnDemoPublication: CatalogPublication = {
  ...demoPublication,
  id: "tmochi-learn-demo",
  title: "Inside a Living Cell",
  description:
    "Choose a route through the cell and discover how its systems keep life in motion.",
  tags: ["biology", "cells", "prototype"],
  categories: ["Education", "Science & Technology"],
  topics: ["cell biology", "life sciences", "human body"],
  creatorHandle: "tMochi Learn",
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const rounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

const pathForOption = (
  option: InteractivePublicationChoiceOption,
  paths: InteractivePublicationVideoPath[],
  currentPathId: string,
  defaultPathId: string,
) => {
  const eligible = paths.filter((path) => option.leaf_path_ids.includes(path.path_id));
  return (
    eligible.find((path) => path.path_id === currentPathId) ??
    eligible.find((path) => path.path_id === defaultPathId) ??
    [...eligible].sort((a, b) => (a.ordinal ?? 999) - (b.ordinal ?? 999))[0]
  );
};

function PublicationCard({
  publication,
  onPlay,
  featured = false,
  prototype = false,
}: {
  publication: InteractivePublication;
  onPlay: (
    publication: InteractivePublication,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => void;
  featured?: boolean;
  prototype?: boolean;
}) {
  const branches = publication.manifest.outputs.paths.length;
  return (
    <article className={`film-card ${featured ? "film-card-featured" : ""}`}>
      <a
        className="film-poster"
        href={publicationPath(publication.id)}
        onClick={(event) => onPlay(publication, event)}
        aria-label={`Play ${publication.title}`}
      >
        <img
          src={publication.mainThumbnailUrl || publication.thumbnailUrl}
          alt=""
          loading={featured ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={featured ? "high" : "low"}
        />
        <span className="poster-shade" />
        <span className="play-orbit">
          <Play size={featured ? 25 : 20} fill="currentColor" />
        </span>
        <span className="card-badge">
          <GitFork size={13} /> {branches} paths
        </span>
        {prototype && <span className="prototype-badge">Player preview</span>}
      </a>
      {!featured && (
        <div className="film-card-copy">
          <div>
            <h3>{publication.title}</h3>
            <p>@{publication.creatorHandle || "unknown"}</p>
          </div>
          <span>{formatTime(publication.duration)}</span>
        </div>
      )}
    </article>
  );
}

function LearnPublicationCard({
  publication,
  onPlay,
  featured = false,
}: {
  publication: CatalogPublication;
  onPlay: (
    publication: InteractivePublication,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => void;
  featured?: boolean;
}) {
  const topics = publication.topics?.slice(0, featured ? 3 : 2) ?? [];
  const branches = publication.manifest.outputs.paths.length;

  return (
    <article className={`learn-card ${featured ? "learn-card-featured" : ""}`}>
      <a
        className="learn-card-media"
        href={publicationPath(publication.id)}
        onClick={(event) => onPlay(publication, event)}
        aria-label={`Start ${publication.title}`}
      >
        <img
          src={publication.mainThumbnailUrl || publication.thumbnailUrl}
          alt=""
          loading={featured ? "eager" : "lazy"}
          decoding="async"
        />
        <span className="learn-card-shade" />
        <span className="learn-card-play"><Play size={featured ? 22 : 18} fill="currentColor" /></span>
        <span className="learn-path-count"><GitFork size={12} /> {branches} paths</span>
      </a>
      <div className="learn-card-copy">
        <div className="learn-topic-row">
          {topics.map((topic) => <span key={topic}>{topic}</span>)}
        </div>
        <h3>{publication.title}</h3>
        {featured && <p>{publication.description}</p>}
        <div className="learn-card-meta">
          <span>@{publication.creatorHandle || "unknown"}</span>
          <span>{formatTime(publication.duration)}</span>
        </div>
      </div>
    </article>
  );
}

const InteractivePlayer = forwardRef<InteractivePlayerHandle, {
  publication: InteractivePublication;
  onClose: () => void;
  startPaused: boolean;
}>(function InteractivePlayer({ publication, onClose, startPaused }, ref) {
  const isMobileLoading = useMobilePlayerLoading();
  const paths = publication.manifest.outputs.paths;
  const defaultPath =
    paths.find((path) => path.path_id === publication.manifest.default_path_id) ??
    paths.find((path) => path.is_default) ??
    paths[0];
  const [activePathId, setActivePathId] = useState(defaultPath?.path_id ?? "");
  const [pendingChoice, setPendingChoice] = useState<InteractivePublicationChoicePoint | null>(null);
  const [previewChoice, setPreviewChoice] = useState<InteractivePublicationChoicePoint | null>(null);
  const [handledChoices, setHandledChoices] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(defaultPath?.duration ?? publication.duration);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [switching, setSwitching] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [awaitingStart, setAwaitingStart] = useState(startPaused);
  const videoElementsRef = useRef(new Map<string, HTMLVideoElement>());
  const playerRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<{
    pathId: string;
    time: number;
    volume: number;
    muted: boolean;
    rate: number;
  } | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const choiceTransitionWatchRef = useRef<ChoiceTransitionWatch | null>(null);
  const choiceAudioFadeRef = useRef<{
    video: HTMLVideoElement;
    baseVolume: number;
  } | null>(null);
  const presentedChoiceIdRef = useRef<string | null>(null);
  const preloadedThumbnailUrlsRef = useRef(new Set<string>());
  const activePath = paths.find((path) => path.path_id === activePathId) ?? defaultPath;

  const nextChoice = useMemo(() => {
    return [...publication.manifest.tree.choice_points]
      .filter(
        (point) =>
          !handledChoices.includes(point.branch_point_id) &&
          point.options.some((option) => option.leaf_path_ids.includes(activePathId)),
      )
      .sort((a, b) => a.switch_at_seconds - b.switch_at_seconds)[0];
  }, [activePathId, handledChoices, publication.manifest.tree.choice_points]);

  const bufferedPaths = useMemo(() => {
    if (isMobileLoading || !nextChoice) return [];
    const candidates = nextChoice.options
      .map((option) => pathForOption(
        option,
        paths,
        activePathId,
        publication.manifest.default_path_id,
      ))
      .filter((path): path is InteractivePublicationVideoPath => Boolean(path));
    return candidates
      .filter((path, index) =>
        path.path_id !== activePathId &&
        candidates.findIndex((candidate) => candidate.path_id === path.path_id) === index,
      )
      .slice(0, 2);
  }, [activePathId, isMobileLoading, nextChoice, paths, publication.manifest.default_path_id]);

  const mountedPaths = useMemo(() => {
    if (!activePath) return bufferedPaths;
    return [activePath, ...bufferedPaths];
  }, [activePath, bufferedPaths]);

  const nextChoiceThumbnailUrls = useMemo(() => {
    if (!nextChoice) return [];

    return [...new Set(nextChoice.options.map((option) => {
      const target = pathForOption(
        option,
        paths,
        activePathId,
        publication.manifest.default_path_id,
      );
      return target?.thumbnailUrl || publication.mainThumbnailUrl || publication.thumbnailUrl;
    }).filter((url): url is string => Boolean(url)))];
  }, [activePathId, nextChoice, paths, publication.mainThumbnailUrl, publication.manifest.default_path_id, publication.thumbnailUrl]);

  const getActiveVideo = useCallback(
    () => videoElementsRef.current.get(activePathId) ?? null,
    [activePathId],
  );

  const clearChoiceTransitionWatch = useCallback(() => {
    const watch = choiceTransitionWatchRef.current;
    if (!watch) return;
    if (watch.audioFadeTimeoutId !== undefined) window.clearTimeout(watch.audioFadeTimeoutId);
    if (watch.audioFadeIntervalId !== undefined) window.clearInterval(watch.audioFadeIntervalId);
    if (watch.previewTimeoutId !== undefined) window.clearTimeout(watch.previewTimeoutId);
    if (watch.boundaryTimeoutId !== undefined) window.clearTimeout(watch.boundaryTimeoutId);
    if (
      watch.frameCallbackId !== undefined &&
      typeof watch.video.cancelVideoFrameCallback === "function"
    ) {
      watch.video.cancelVideoFrameCallback(watch.frameCallbackId);
    }
    choiceTransitionWatchRef.current = null;
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

  const presentChoiceAtBoundary = useCallback((
    video: HTMLVideoElement,
    pathId: string,
    choice: InteractivePublicationChoicePoint,
  ) => {
    if (
      pathId !== activePathId ||
      presentedChoiceIdRef.current === choice.branch_point_id
    ) {
      return;
    }

    presentedChoiceIdRef.current = choice.branch_point_id;
    clearChoiceTransitionWatch();
    updateChoiceAudioFade(video, choice.switch_at_seconds, choice.switch_at_seconds);
    video.currentTime = choice.switch_at_seconds;
    video.pause();
    setCurrentTime(choice.switch_at_seconds);
    setPreviewChoice(choice);
    setPendingChoice(choice);
  }, [activePathId, clearChoiceTransitionWatch, updateChoiceAudioFade]);

  const playWithSound = useCallback(async () => {
    const video = getActiveVideo();
    if (!video || pendingChoice) return;

    video.muted = false;
    video.volume = 1;
    setMuted(false);
    try {
      await video.play();
      setAwaitingStart(false);
    } catch {
      setPlaying(false);
      setAwaitingStart(true);
    }
  }, [getActiveVideo, pendingChoice]);

  useImperativeHandle(ref, () => ({ playWithSound }), [playWithSound]);

  const togglePlay = useCallback(async () => {
    const video = getActiveVideo();
    if (!video || pendingChoice) return;
    if (video.paused) {
      if (awaitingStart) await playWithSound();
      else await video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [awaitingStart, getActiveVideo, pendingChoice, playWithSound]);

  const clearControlsTimer = useCallback(() => {
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  const revealControls = useCallback(() => {
    clearControlsTimer();
    setControlsVisible(true);
    if (playing && !pendingChoice && !switching) {
      controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 1900);
    }
  }, [clearControlsTimer, pendingChoice, playing, switching]);

  const pinControls = useCallback(() => {
    clearControlsTimer();
    setControlsVisible(true);
  }, [clearControlsTimer]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (playing && !pendingChoice && !switching) {
        revealControls();
      } else {
        clearControlsTimer();
        setControlsVisible(true);
      }
    });
    return () => {
      active = false;
      clearControlsTimer();
    };
  }, [clearControlsTimer, pendingChoice, playing, revealControls, switching]);

  useEffect(() => {
    clearChoiceTransitionWatch();
    if (!playing || pendingChoice || !nextChoice || switching) return;

    const video = videoElementsRef.current.get(activePathId);
    if (!video) return;

    const watch: ChoiceTransitionWatch = { video };
    choiceTransitionWatchRef.current = watch;
    const switchAt = nextChoice.switch_at_seconds;
    const audioFadeAt = Math.max(0, switchAt - CHOICE_AUDIO_FADE_LEAD_SECONDS);
    const previewAt = Math.max(0, switchAt - CHOICE_FADE_LEAD_SECONDS);
    const fadeAudio = () => {
      if (
        choiceTransitionWatchRef.current !== watch ||
        video.paused ||
        activePathId !== video.dataset.pathId
      ) {
        return;
      }
      updateChoiceAudioFade(video, switchAt, video.currentTime);
    };
    const startAudioFade = () => {
      fadeAudio();
      if (choiceTransitionWatchRef.current !== watch) return;
      watch.audioFadeIntervalId = window.setInterval(
        fadeAudio,
        CHOICE_AUDIO_FADE_INTERVAL_MS,
      );
    };
    const showPreview = () => {
      if (
        choiceTransitionWatchRef.current !== watch ||
        video.paused ||
        activePathId !== video.dataset.pathId
      ) {
        return;
      }
      setPreviewChoice(nextChoice);
    };
    const stopAtBoundary = () => {
      if (
        choiceTransitionWatchRef.current !== watch ||
        video.paused ||
        activePathId !== video.dataset.pathId
      ) {
        return;
      }
      presentChoiceAtBoundary(video, activePathId, nextChoice);
    };
    const playbackRate = Math.max(0.1, video.playbackRate);
    const audioFadeDelay = Math.max(0, ((audioFadeAt - video.currentTime) / playbackRate) * 1_000);
    const previewDelay = Math.max(0, ((previewAt - video.currentTime) / playbackRate) * 1_000);
    const boundaryDelay = Math.max(0, ((switchAt - video.currentTime) / playbackRate) * 1_000);

    watch.audioFadeTimeoutId = window.setTimeout(startAudioFade, audioFadeDelay);
    watch.previewTimeoutId = window.setTimeout(showPreview, previewDelay);
    watch.boundaryTimeoutId = window.setTimeout(stopAtBoundary, boundaryDelay);

    if (typeof video.requestVideoFrameCallback === "function") {
      const inspectFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (choiceTransitionWatchRef.current !== watch) return;
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

    return clearChoiceTransitionWatch;
  }, [
    activePathId,
    clearChoiceTransitionWatch,
    currentTime,
    nextChoice,
    pendingChoice,
    playbackRate,
    playing,
    presentChoiceAtBoundary,
    switching,
    updateChoiceAudioFade,
  ]);

  useEffect(() => () => {
    clearChoiceTransitionWatch();
    restoreChoiceAudioVolume();
  }, [clearChoiceTransitionWatch, restoreChoiceAudioVolume]);

  useEffect(() => {
    if (
      !nextChoice ||
      (isMobileLoading && !playing) ||
      nextChoice.switch_at_seconds - currentTime > CHOICE_PROMPT_LEAD_SECONDS
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
  }, [currentTime, isMobileLoading, nextChoice, nextChoiceThumbnailUrls, playing]);

  useEffect(() => {
    if (!nextChoice) return;

    const primeAt = nextChoice.switch_at_seconds + 0.04;
    const cleanup: Array<() => void> = [];

    bufferedPaths.forEach((path) => {
      const video = videoElementsRef.current.get(path.path_id);
      if (!video) return;

      const primeBranchFrame = () => {
        const pathDuration = Number.isFinite(video.duration) ? video.duration : path.duration;
        const targetTime = Math.min(primeAt, Math.max(pathDuration - 0.1, 0));
        if (Math.abs(video.currentTime - targetTime) > 0.08) {
          video.currentTime = targetTime;
        }
      };

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        primeBranchFrame();
      } else {
        video.addEventListener("loadedmetadata", primeBranchFrame, { once: true });
        cleanup.push(() => video.removeEventListener("loadedmetadata", primeBranchFrame));
      }

      if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) {
        video.load();
      }
    });

    return () => cleanup.forEach((removeListener) => removeListener());
  }, [bufferedPaths, nextChoice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        void togglePlay();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("player-open");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("player-open");
    };
  }, [onClose, togglePlay]);

  if (!activePath) return null;

  const handleTimeUpdate = (video: HTMLVideoElement, pathId: string) => {
    if (pathId !== activePathId) return;
    setCurrentTime(video.currentTime);
    if (nextChoice) {
      updateChoiceAudioFade(video, nextChoice.switch_at_seconds, video.currentTime);
    }
    if (nextChoice && video.currentTime >= nextChoice.switch_at_seconds) {
      presentChoiceAtBoundary(video, pathId, nextChoice);
    }
  };

  const chooseBranch = (option: InteractivePublicationChoiceOption) => {
    if (!pendingChoice) return;
    const video = getActiveVideo();
    const target = pathForOption(
      option,
      paths,
      activePathId,
      publication.manifest.default_path_id,
    );
    if (!target || !video) return;

    const resumeAt = pendingChoice.switch_at_seconds + 0.04;
    const resumeVolume = restoreChoiceAudioVolume(video);
    clearChoiceTransitionWatch();
    presentedChoiceIdRef.current = null;
    setHandledChoices((previous) => [...previous, pendingChoice.branch_point_id]);
    setPendingChoice(null);
    setPreviewChoice(null);

    if (target.path_id === activePathId) {
      video.currentTime = resumeAt;
      void video.play().catch(() => undefined);
      return;
    }

    resumeRef.current = {
      pathId: target.path_id,
      time: resumeAt,
      volume: resumeVolume,
      muted: video.muted,
      rate: video.playbackRate,
    };
    setSwitching(true);
    setActivePathId(target.path_id);

    const bufferedVideo = videoElementsRef.current.get(target.path_id);
    if (bufferedVideo && bufferedVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      bufferedVideo.volume = resumeVolume;
      bufferedVideo.muted = video.muted;
      bufferedVideo.playbackRate = video.playbackRate;
      bufferedVideo.currentTime = Math.min(
        resumeAt,
        Math.max((Number.isFinite(bufferedVideo.duration) ? bufferedVideo.duration : target.duration) - 0.1, 0),
      );
      resumeRef.current = null;
      setDuration(Number.isFinite(bufferedVideo.duration) ? bufferedVideo.duration : target.duration);
      const handlePlaying = () => {
        setPlaying(true);
        setSwitching(false);
      };
      bufferedVideo.addEventListener("playing", handlePlaying, { once: true });
      void bufferedVideo.play().catch(() => {
        bufferedVideo.removeEventListener("playing", handlePlaying);
        setPlaying(false);
        setSwitching(false);
      });
    }
  };

  const handleLoadedMetadata = (
    video: HTMLVideoElement,
    path: InteractivePublicationVideoPath,
  ) => {
    if (path.path_id === activePathId) {
      setDuration(Number.isFinite(video.duration) ? video.duration : path.duration);
    }
    const resume = resumeRef.current;
    if (resume?.pathId === path.path_id) {
      video.currentTime = Math.min(resume.time, Math.max(video.duration - 0.1, 0));
      video.volume = resume.volume;
      video.muted = resume.muted;
      video.playbackRate = resume.rate;
      resumeRef.current = null;
      void video.play().catch(() => {
        setPlaying(false);
        setSwitching(false);
      });
    }
  };

  const restart = () => {
    const video = getActiveVideo();
    const restartVolume = restoreChoiceAudioVolume(video);
    clearChoiceTransitionWatch();
    presentedChoiceIdRef.current = null;
    setHandledChoices([]);
    setPendingChoice(null);
    setPreviewChoice(null);
    if (activePathId !== defaultPath.path_id) {
      video?.pause();
      resumeRef.current = {
        pathId: defaultPath.path_id,
        time: 0,
        volume: restartVolume,
        muted,
        rate: playbackRate,
      };
      setSwitching(true);
      setActivePathId(defaultPath.path_id);

      const bufferedDefault = videoElementsRef.current.get(defaultPath.path_id);
      if (bufferedDefault && bufferedDefault.readyState >= HTMLMediaElement.HAVE_METADATA) {
        bufferedDefault.currentTime = 0;
        bufferedDefault.volume = restartVolume;
        bufferedDefault.muted = muted;
        bufferedDefault.playbackRate = playbackRate;
        resumeRef.current = null;
        setDuration(Number.isFinite(bufferedDefault.duration) ? bufferedDefault.duration : defaultPath.duration);
        const handlePlaying = () => {
          setPlaying(true);
          setSwitching(false);
        };
        bufferedDefault.addEventListener("playing", handlePlaying, { once: true });
        void bufferedDefault.play().catch(() => {
          bufferedDefault.removeEventListener("playing", handlePlaying);
          setPlaying(false);
          setSwitching(false);
        });
      }
    } else if (video) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }
  };

  const seek = (value: number) => {
    const video = getActiveVideo();
    if (!video || pendingChoice) return;
    video.currentTime = value;
    if (nextChoice) updateChoiceAudioFade(video, nextChoice.switch_at_seconds, value);
    setCurrentTime(value);
  };

  const toggleMute = () => {
    const video = getActiveVideo();
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const cycleRate = () => {
    const rates = [1, 1.25, 1.5, 0.75];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    const video = getActiveVideo();
    if (video) video.playbackRate = next;
    setPlaybackRate(next);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void playerRef.current?.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  };

  const displayedChoice = pendingChoice ?? previewChoice;
  const secondsUntilChoice = nextChoice
    ? nextChoice.switch_at_seconds - currentTime
    : Number.POSITIVE_INFINITY;
  const showChoicePrompt = Boolean(
    playing &&
    nextChoice &&
    !displayedChoice &&
    secondsUntilChoice <= CHOICE_PROMPT_LEAD_SECONDS &&
    secondsUntilChoice > CHOICE_FADE_LEAD_SECONDS,
  );

  return (
    <div className="player-shell" role="dialog" aria-modal="true" aria-label={`Playing ${publication.title}`}>
      <div
        className={`player-stage ${controlsVisible ? "controls-visible" : "controls-hidden"}`}
        ref={playerRef}
        onPointerMove={revealControls}
        onPointerDown={revealControls}
        onPointerLeave={() => playing && !pendingChoice && setControlsVisible(false)}
      >
        <div
          className="player-topbar"
          onPointerEnter={pinControls}
          onPointerLeave={revealControls}
          onFocusCapture={pinControls}
          onBlurCapture={revealControls}
        >
          <div>
            <span className="live-dot" />
            <span>Interactive film</span>
            <span className="topbar-divider" />
            <strong>{publication.title}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close player">
            <X size={20} />
          </button>
        </div>

        {mountedPaths.map((path) => {
          const isActive = path.path_id === activePathId;
          const contentUrl = path.path_id === defaultPath.path_id
            ? publication.mainVideoUrl || path.contentUrl
            : path.contentUrl;
          return (
            <video
              key={path.path_id}
              ref={(element) => {
                if (element) videoElementsRef.current.set(path.path_id, element);
                else videoElementsRef.current.delete(path.path_id);
              }}
              className={`player-video ${isActive ? "is-active" : "is-preloading"} ${isActive && switching ? "is-switching" : ""}`}
              data-path-id={path.path_id}
              src={contentUrl}
              poster={isActive ? publication.mainThumbnailUrl : undefined}
              preload={isActive || !isMobileLoading ? "auto" : "none"}
              playsInline
              tabIndex={isActive ? 0 : -1}
              aria-hidden={!isActive}
              onClick={isActive ? () => void togglePlay() : undefined}
              onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget, path)}
              onTimeUpdate={isActive ? (event) => handleTimeUpdate(event.currentTarget, path.path_id) : undefined}
              onPlay={() => {
                if (isActive) {
                  setPlaying(true);
                  setAwaitingStart(false);
                }
              }}
              onPlaying={() => isActive && setSwitching(false)}
              onPause={() => {
                if (isActive) {
                  setPlaying(false);
                  if (!presentedChoiceIdRef.current) setPreviewChoice(null);
                }
              }}
              onEnded={() => isActive && setPlaying(false)}
              onVolumeChange={isActive ? (event) => setMuted(event.currentTarget.muted) : undefined}
            />
          );
        })}

        {awaitingStart && !pendingChoice && (
          <div className="player-start">
            <button type="button" onClick={() => void playWithSound()} aria-label={`Play ${publication.title} with sound`}>
              <Play size={34} fill="currentColor" />
            </button>
          </div>
        )}

        {switching && (
          <div className="switch-loader" aria-live="polite">
            <LoaderCircle size={24} />
            <span>Switching timeline</span>
          </div>
        )}

        {showChoicePrompt && (
          <div className="choice-prompt" role="status">
            <GitFork size={14} />
            <span>Choose the next path</span>
          </div>
        )}

        {displayedChoice && (
          <div
            className={`choice-overlay ${pendingChoice ? "is-ready" : "is-previewing"}`}
            aria-hidden={!pendingChoice}
          >
            <div className={`choice-heading ${handledChoices.length > 0 ? "is-followup" : ""}`}>
              {handledChoices.length === 0 && <h2>Where does the story go?</h2>}
              <p>Choose a path to continue</p>
            </div>
            <div
              className="choice-grid"
              style={{ "--choice-count": displayedChoice.options.length } as React.CSSProperties}
            >
              {displayedChoice.options.map((option, index) => {
                const target = pathForOption(
                  option,
                  paths,
                  activePathId,
                  publication.manifest.default_path_id,
                );
                const Arrow = index === 0 ? Undo2 : Redo2;
                return (
                  <button
                    key={`${displayedChoice.branch_point_id}-${option.child_node_id}`}
                    className={`choice-card ${index === 0 ? "choice-card-left" : "choice-card-right"}`}
                    type="button"
                    onClick={() => chooseBranch(option)}
                    disabled={!pendingChoice}
                    aria-label={`Choose ${option.branching_hint || option.path_name || `path ${index + 1}`}`}
                  >
                    <img src={target?.thumbnailUrl || publication.mainThumbnailUrl} alt="" />
                    <span className="choice-card-shade" />
                    <span className="choice-direction">
                      <Arrow size={31} strokeWidth={1.55} />
                    </span>
                    <span className="choice-copy">
                      <strong>{option.branching_hint || option.path_name || `Path ${index + 1}`}</strong>
                      <span>{option.description || option.path_description || "Continue this story"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          className="player-controls"
          onPointerEnter={pinControls}
          onPointerLeave={revealControls}
          onFocusCapture={pinControls}
          onBlurCapture={revealControls}
        >
          <div className="timeline-row">
            <span>{formatTime(currentTime)}</span>
            <input
              aria-label="Video timeline"
              type="range"
              min={0}
              max={duration || 1}
              step={0.05}
              value={Math.min(currentTime, duration || 1)}
              onChange={(event) => seek(Number(event.target.value))}
              style={{ "--progress": `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
            />
            <span>{formatTime(duration)}</span>
          </div>
          <div className="control-row">
            <div>
              <button type="button" onClick={() => void togglePlay()} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              <button type="button" onClick={restart} aria-label="Restart film">
                <RotateCcw size={18} />
              </button>
              <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
              <button className="rate-button" type="button" onClick={cycleRate} aria-label="Change playback speed">
                {playbackRate}×
              </button>
            </div>
            <div className="path-readout">
              <GitFork size={15} />
              <span>{activePath.branching_hint || activePath.path_id}</span>
            </div>
            <button type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
              <Expand size={19} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function Home({
  initialPublicationId,
  initialPublication,
  catalogMode = "home",
}: {
  initialPublicationId?: string;
  initialPublication?: InteractivePublication;
  catalogMode?: "home" | "learn";
}) {
  const [response, setResponse] = useState<PublicationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selected, setSelected] = useState<InteractivePublication | null>(initialPublication ?? null);
  const [playerEntry, setPlayerEntry] = useState<PlayerEntry>(initialPublicationId ? "direct" : "internal");
  const [routeLoading, setRouteLoading] = useState(Boolean(initialPublicationId && !initialPublication));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const playerHandleRef = useRef<InteractivePlayerHandle>(null);
  const routeRequestRef = useRef(0);
  const isLearn = catalogMode === "learn";

  const clearPlayerRoute = useCallback(() => {
    routeRequestRef.current += 1;
    setSelected(null);
    setRouteLoading(false);
    setRouteError(null);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const returnToLanding = useCallback(() => {
    clearPlayerRoute();
    window.history.replaceState(null, "", isLearn ? "/learn" : "/");
  }, [clearPlayerRoute, isLearn]);

  const loadPublicationRoute = useCallback(async (publicationId: string) => {
    const requestId = ++routeRequestRef.current;
    setPlayerEntry("direct");
    setSelected(null);
    setRouteLoading(true);
    setRouteError(null);

    if (publicationId === demoPublication.id) {
      setSelected(demoPublication);
      setRouteLoading(false);
      return;
    }

    try {
      const request = await fetch(`/api/interactive-publications/${encodeURIComponent(publicationId)}`);
      if (!request.ok) throw new Error(request.status === 404 ? "not-found" : "unavailable");
      const detail = (await request.json()) as PublicationDetailResponse;
      if (routeRequestRef.current !== requestId) return;
      setSelected(detail.publication);
    } catch (requestError) {
      if (routeRequestRef.current !== requestId) return;
      setRouteError(
        requestError instanceof Error && requestError.message === "not-found"
          ? "This interactive film is no longer available."
          : "This interactive film could not be loaded.",
      );
    } finally {
      if (routeRequestRef.current === requestId) setRouteLoading(false);
    }
  }, []);

  const loadPublications = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const query = new URLSearchParams({ limit: isLearn ? "200" : "24" });
      if (isLearn) query.set("category", "Education");
      if (cursor) query.set("cursor", cursor);
      const request = await fetch(`/api/interactive-publications?${query}`);
      if (!request.ok) throw new Error("Catalog request failed");
      const next = (await request.json()) as PublicationResponse;
      setResponse((previous) =>
        cursor && previous
          ? { ...next, items: [...previous.items, ...next.items] }
          : next,
      );
      setError(null);
    } catch {
      setError("The live catalog is momentarily out of range.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [isLearn]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadPublications();
    });
    return () => {
      active = false;
    };
  }, [loadPublications]);

  useEffect(() => {
    const syncPlayerRoute = () => {
      const publicationId = publicationIdFromLocation();
      if (publicationId) {
        void loadPublicationRoute(publicationId);
      } else {
        clearPlayerRoute();
      }
    };

    let active = true;
    if (initialPublicationId && initialPublication?.id !== initialPublicationId) {
      queueMicrotask(() => {
        if (active) void loadPublicationRoute(initialPublicationId);
      });
    }
    window.addEventListener("popstate", syncPlayerRoute);
    return () => {
      active = false;
      window.removeEventListener("popstate", syncPlayerRoute);
    };
  }, [clearPlayerRoute, initialPublication?.id, initialPublicationId, loadPublicationRoute]);

  const livePublications = response?.items ?? [];
  const eligiblePublications = isLearn
    ? livePublications.filter((publication) =>
        publication.categories?.some((category) => category.trim().toLowerCase() === "education"),
      )
    : livePublications;
  const isPrototype = !loading && !error && eligiblePublications.length === 0;
  const publications = isPrototype
    ? [isLearn ? learnDemoPublication : demoPublication]
    : eligiblePublications;
  const topicCounts = (() => {
    const counts = new Map<string, number>();
    publications.forEach((publication) => {
      publication.topics?.forEach((topic) => counts.set(topic, (counts.get(topic) ?? 0) + 1));
    });
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  })();
  const filtered = publications.filter((publication) => {
    const haystack = [
      publication.title,
      publication.description,
      publication.creatorHandle,
      ...publication.tags,
      ...(publication.categories ?? []),
      ...(publication.topics ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase()) &&
      (!selectedTopic || publication.topics?.includes(selectedTopic));
  });
  const featured = publications[0];
  const hasSearch = Boolean(search.trim());
  const feedItems = hasSearch || selectedTopic
    ? filtered
    : filtered.filter((publication) => publication.id !== featured?.id);

  const openPlayer = useCallback((
    publication: InteractivePublication,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;

    event.preventDefault();
    flushSync(() => {
      setPlayerEntry("internal");
      setRouteLoading(false);
      setRouteError(null);
      setSelected(publication);
    });
    void playerHandleRef.current?.playWithSound();
    window.history.pushState({ tmochiPlayer: true }, "", publicationPath(publication.id));
  }, []);

  const closePlayer = useCallback(() => {
    setSelected(null);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    if (playerEntry === "internal") window.history.back();
    else returnToLanding();
  }, [playerEntry, returnToLanding]);

  const openCreator = useCallback(async () => {
    if (creatingSession) return;
    setCreatingSession(true);
    try {
      const response = await fetch("/api/creator/session", { method: "POST" });
      const result = await response.json().catch(() => null) as {
        sessionId?: string;
        status?: string;
      } | null;
      if (response.status === 401) {
        window.location.assign("/creator");
        return;
      }
      if (!response.ok || !result?.sessionId) {
        throw new Error("Unable to create a Creator Studio session.");
      }
      const isDraft = result.status?.toUpperCase() === "INIT";
      window.location.assign(
        `/creator/${encodeURIComponent(result.sessionId)}${isDraft ? "?draft=1" : ""}`,
      );
    } catch {
      window.location.assign("/creator");
    }
  }, [creatingSession]);

  return (
    <main className={isLearn ? "learn-page" : undefined}>
      <header className={`site-header ${isLearn ? "learn-site-header" : ""}`}>
        <Link className="brand" href={isLearn ? "/" : "#top"} aria-label="tMochi home">
          <TmochiLogo />
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <Link href="/" aria-current={!isLearn ? "page" : undefined}>Watch</Link>
          <Link href="/learn" aria-current={isLearn ? "page" : undefined}>Learn</Link>
        </nav>
        <button
          className="publish-button"
          type="button"
          onClick={() => void openCreator()}
          disabled={creatingSession}
        >
          {creatingSession ? <LoaderCircle size={16} /> : <WandSparkles size={16} />}
          {creatingSession ? "Opening studio" : "Create"}
        </button>
      </header>

      {isLearn ? (
        <>
          <section className="learn-hero" id="top">
            <div>
              <span className="eyebrow"><BookOpen size={13} /> Interactive learning library</span>
              <h1>Choose what you<br /><em>learn next.</em></h1>
              <p>Explore lessons that respond to your decisions. Every choice opens a new way to understand the subject.</p>
            </div>
            <div className="learn-hero-mark" aria-hidden="true">
              <span>LEARN</span>
              <GitFork size={27} />
            </div>
          </section>

          <section className="learn-library" aria-label="Educational interactive content">
            <aside className="learn-sidebar">
              <span className="learn-sidebar-label">Explore topics</span>
              <button
                className={!selectedTopic ? "is-active" : undefined}
                type="button"
                onClick={() => setSelectedTopic(null)}
              >
                <span>All lessons</span><small>{publications.length}</small>
              </button>
              {topicCounts.map(([topic, count]) => (
                <button
                  className={selectedTopic === topic ? "is-active" : undefined}
                  key={topic}
                  type="button"
                  onClick={() => setSelectedTopic(topic)}
                >
                  <span>{topic}</span><small>{count}</small>
                </button>
              ))}
            </aside>

            <div className="learn-catalog">
              <div className="learn-catalog-head">
                <div>
                  <span className="eyebrow">Curated for curiosity</span>
                  <h2>{selectedTopic || "Featured learning"}</h2>
                </div>
                <label className="search-box learn-search">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search lessons and topics"
                    aria-label="Search educational content"
                  />
                  {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
                </label>
              </div>

              {isPrototype && !loading && !error && (
                <div className="prototype-note learn-prototype-note">
                  <span><Sparkles size={15} /></span>
                  <p><strong>Learn is ready for its first lesson.</strong> This clearly marked preview demonstrates the educational catalog and interactive player.</p>
                </div>
              )}

              {error && (
                <div className="catalog-state">
                  <BookOpen size={28} />
                  <h3>Library unavailable</h3>
                  <p>{error}</p>
                  <button type="button" onClick={() => void loadPublications()}>Try again</button>
                </div>
              )}

              {loading && (
                <div className="learn-grid" aria-label="Loading lessons">
                  {[0, 1, 2, 3, 4, 5].map((item) => <div className="film-skeleton" key={item} />)}
                </div>
              )}

              {!loading && !error && featured && !hasSearch && !selectedTopic && (
                <div className="learn-feature">
                  <LearnPublicationCard publication={featured} onPlay={openPlayer} featured />
                </div>
              )}

              {!loading && !error && feedItems.length > 0 && (
                <div className="learn-section-block">
                  <div className="learn-row-heading">
                    <h3>{hasSearch || selectedTopic ? "Matching lessons" : "More to explore"}</h3>
                    <span>{feedItems.length} {feedItems.length === 1 ? "lesson" : "lessons"}</span>
                  </div>
                  <div className="learn-grid">
                    {feedItems.map((publication) => (
                      <LearnPublicationCard key={publication.id} publication={publication} onPlay={openPlayer} />
                    ))}
                  </div>
                </div>
              )}

              {!loading && !error && (hasSearch || selectedTopic) && feedItems.length === 0 && (
                <div className="catalog-state compact">
                  <Search size={24} />
                  <h3>No matching lessons</h3>
                  <p>Try another topic or a broader search.</p>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="hero" id="top">
            <div className="hero-feature">
              {featured ? (
                <PublicationCard publication={featured} onPlay={openPlayer} featured prototype={isPrototype} />
              ) : (
                <div className="feature-placeholder">
                  {loading ? <LoaderCircle size={26} /> : <Film size={28} />}
                  <span>{loading ? "Tuning the live feed" : "Awaiting the next premiere"}</span>
                </div>
              )}
              <div className="hero-overlay">
                <h1>Don’t just watch. <em>Decide.</em></h1>
                <p className="hero-summary">
                  <span className="hero-summary-line"><span>Stories that bend around your choices.</span></span>
                  <span className="hero-summary-line"><span>Every path is a different cut.</span></span>
                  <span className="hero-summary-line"><span>Every decision is yours.</span></span>
                </p>
              </div>
            </div>
          </section>

          <section className="explore-section" id="explore">
            <div className="section-heading">
              <div><span className="eyebrow">Now transmitting</span><h2>Interactive stories</h2></div>
              <div className="catalog-tools">
                <label className="search-box">
                  <Search size={17} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stories" aria-label="Search interactive stories" />
                  {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
                </label>
                <span className="catalog-count">{isPrototype ? "Preview mode" : `${response?.totalCount ?? publications.length} films`}</span>
              </div>
            </div>
            {isPrototype && <div className="prototype-note"><span><Sparkles size={15} /></span><p><strong>The live catalog is ready.</strong> No films are published yet, so this prototype reel lets you test the branching player now.</p></div>}
            {error && <div className="catalog-state"><Film size={28} /><h3>Signal interrupted</h3><p>{error}</p><button type="button" onClick={() => void loadPublications()}>Try again</button></div>}
            {loading && <div className="film-grid" aria-label="Loading films">{[0, 1, 2].map((item) => <div className="film-skeleton" key={item} />)}</div>}
            {!loading && !error && feedItems.length > 0 && <div className="film-grid">{feedItems.map((publication) => <PublicationCard key={publication.id} publication={publication} onPlay={openPlayer} prototype={isPrototype} />)}</div>}
            {!loading && !error && hasSearch && feedItems.length === 0 && <div className="catalog-state compact"><Search size={24} /><h3>No matching timelines</h3><p>Try a different title, creator, or tag.</p></div>}
            {response?.hasMore && !search && <button className="load-more" type="button" disabled={loadingMore} onClick={() => response.nextCursor && void loadPublications(response.nextCursor)}>{loadingMore ? <LoaderCircle size={17} /> : <ChevronDown size={17} />}{loadingMore ? "Loading" : "Load more stories"}</button>}
          </section>
        </>
      )}

      <footer>
        <div className="brand" role="img" aria-label="tMochi"><TmochiLogo /></div>
        <p>{isLearn ? "Interactive lessons, shaped by every choice." : "Interactive cinema, rendered in real time."}</p>
        <span>Powered by Samsar</span>
      </footer>

      {selected && (
        <InteractivePlayer
          key={selected.id}
          ref={playerHandleRef}
          publication={selected}
          onClose={closePlayer}
          startPaused={playerEntry === "direct"}
        />
      )}

      {!selected && (routeLoading || routeError) && (
        <div className="player-route-state" role="status" aria-live="polite">
          {routeLoading ? <LoaderCircle size={28} /> : <Film size={30} />}
          <h1>{routeLoading ? "Loading interactive film" : "Film unavailable"}</h1>
          {routeError && <p>{routeError}</p>}
          {routeError && <button type="button" onClick={returnToLanding}>Back to films</button>}
        </div>
      )}

    </main>
  );
}
