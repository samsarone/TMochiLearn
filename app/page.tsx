"use client";

import {
  BookOpen,
  ChevronDown,
  Expand,
  Film,
  GitFork,
  LoaderCircle,
  Minimize2,
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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { TMochiLearnLogo } from "../components/tmochi-learn-logo";

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

type HoverPreviewState = "idle" | "playing" | "tree";

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
  creatorHandle: "TMochiLearn",
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
  creatorHandle: "TMochiLearn",
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

function FeaturedCtaCopy({
  className,
  showSummary = true,
  ariaHidden,
}: {
  className: string;
  showSummary?: boolean;
  ariaHidden?: boolean;
}) {
  return (
    <span className={className} aria-hidden={ariaHidden}>
      <strong className="featured-poster-heading">Learn Topics. <em>Deeply</em></strong>
      {showSummary && (
        <span className="hero-summary featured-poster-summary">
          <span className="hero-summary-line"><span>Every alternative outcome, explained.</span></span>
          <span className="hero-summary-line"><span>Every path, followed.</span></span>
          <span className="hero-summary-line"><span>Every decision builds deeper understanding.</span></span>
        </span>
      )}
    </span>
  );
}

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
  const [previewState, setPreviewState] = useState<HoverPreviewState>("idle");
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const treeTimerRef = useRef<number | null>(null);
  const previewLevels = [...new Set(publication.manifest.tree.choice_points.map((point) => point.level ?? 0))]
    .sort((left, right) => left - right)
    .map((level) => publication.manifest.tree.choice_points
      .filter((point) => (point.level ?? 0) === level)
      .flatMap((point) => point.options));

  const stopPreview = () => {
    if (treeTimerRef.current !== null) window.clearTimeout(treeTimerRef.current);
    treeTimerRef.current = null;
    const video = previewVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPreviewState("idle");
  };

  const startPreview = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType === "touch") return;
    setPreviewState("playing");
    const video = previewVideoRef.current;
    if (video) void video.play().catch(() => undefined);
    treeTimerRef.current = window.setTimeout(() => setPreviewState("tree"), 2400);
  };

  useEffect(() => stopPreview, []);

  return (
    <article className={`film-card ${featured ? "film-card-featured" : ""}`}>
      <a
        className="film-poster"
        href={publicationPath(publication.id)}
        onClick={(event) => onPlay(publication, event)}
        onPointerEnter={startPreview}
        onPointerLeave={stopPreview}
        onFocus={() => setPreviewState("tree")}
        onBlur={stopPreview}
        aria-label={`Start ${publication.title}`}
      >
        <img
          src={publication.mainThumbnailUrl || publication.thumbnailUrl}
          alt=""
          loading={featured ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={featured ? "high" : "low"}
        />
        <video
          ref={previewVideoRef}
          className={`poster-preview-video ${previewState !== "idle" ? "is-visible" : ""}`}
          src={publication.mainVideoUrl}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
        <span className="poster-shade" />
        {featured && <FeaturedCtaCopy className="featured-poster-overlay" showSummary={previewState !== "tree"} ariaHidden />}
        <span className={`play-orbit ${previewState === "tree" ? "is-compact" : ""}`}>
          <Play size={featured ? 25 : 20} fill="currentColor" />
        </span>
        {previewState === "tree" && previewLevels.length > 0 && (
          <span className="poster-tree-preview" aria-hidden="true">
            <span className="poster-tree-root"><GitFork size={13} /></span>
            {previewLevels.map((options, levelIndex) => (
              <span className="poster-tree-segment" key={levelIndex}>
                <span className="poster-tree-line" />
                <span className="poster-tree-options">
                  {options.slice(0, 5).map((option) => <span key={option.child_node_id} />)}
                </span>
              </span>
            ))}
            <span className="poster-tree-segment">
              <span className="poster-tree-line" />
              <span className="poster-tree-options is-leaf">
                {publication.manifest.outputs.paths.slice(0, 5).map((path) => <span key={path.path_id} />)}
              </span>
            </span>
          </span>
        )}
        <span className="card-badge">
          <GitFork size={13} /> {branches} paths
        </span>
        {prototype && <span className="prototype-badge">Player preview</span>}
      </a>
      {!featured && (
        <div className="film-card-copy">
          <div>
            <h3>{publication.title}</h3>
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

function PublicationBranchTree({
  publication,
  activePathId,
  selectedLeafPathId,
  onSelectLeaf,
  onRestart,
  variant = "player",
}: {
  publication: InteractivePublication;
  activePathId: string;
  selectedLeafPathId: string | null;
  onSelectLeaf: (path: InteractivePublicationVideoPath) => void;
  onRestart: () => void;
  variant?: "player" | "featured";
}) {
  const paths = publication.manifest.outputs.paths;
  const choicePoints = [...publication.manifest.tree.choice_points]
    .sort((left, right) => (left.level ?? 0) - (right.level ?? 0) || left.switch_at_seconds - right.switch_at_seconds);
  type FlatTreeNode = {
    id: string;
    depth: number;
    kind: "root" | "decision" | "leaf";
    label: string;
    leafIds: string[];
    tone: number;
    target?: InteractivePublicationVideoPath;
    path?: InteractivePublicationVideoPath;
  };

  const rootId = publication.manifest.tree.root_node_id || "root";
  const nodes = new Map<string, FlatTreeNode>();
  const edges: Array<{ from: string; to: string }> = [];
  nodes.set(rootId, {
    id: rootId,
    depth: 0,
    kind: "root",
    label: "Play from the start",
    leafIds: paths.map((path) => path.path_id),
    tone: 0,
  });

  choicePoints.forEach((point, pointIndex) => {
    const depth = Math.max(1, (point.level ?? pointIndex) + 1);
    const parentId = point.parent_node_id || rootId;
    if (!nodes.has(parentId)) {
      nodes.set(parentId, {
        id: parentId,
        depth: Math.max(1, depth - 1),
        kind: "decision",
        label: "Branch",
        leafIds: [...new Set(point.options.flatMap((option) => option.leaf_path_ids))],
        tone: pointIndex % 4,
      });
      edges.push({ from: rootId, to: parentId });
    }

    point.options.forEach((option, optionIndex) => {
      const nodeId = option.child_node_id || `${point.branch_point_id}-${optionIndex}`;
      const target = pathForOption(
        option,
        paths,
        selectedLeafPathId || activePathId,
        publication.manifest.default_path_id,
      );
      const existing = nodes.get(nodeId);
      nodes.set(nodeId, {
        id: nodeId,
        depth: Math.max(existing?.depth ?? 0, depth),
        kind: "decision",
        label: option.branching_hint || option.path_name || "Branch",
        leafIds: [...new Set([...(existing?.leafIds ?? []), ...option.leaf_path_ids])],
        tone: (pointIndex + optionIndex) % 4,
        target: target ?? existing?.target,
      });
      if (!edges.some((edge) => edge.from === parentId && edge.to === nodeId)) {
        edges.push({ from: parentId, to: nodeId });
      }
    });
  });

  const decisionNodes = [...nodes.values()].filter((node) => node.kind === "decision");
  const leafDepth = Math.max(0, ...decisionNodes.map((node) => node.depth)) + 1;
  paths.forEach((path, index) => {
    const parent = decisionNodes
      .filter((node) => node.leafIds.includes(path.path_id))
      .sort((left, right) => right.depth - left.depth)[0];
    const leafId = `leaf:${path.path_id}`;
    nodes.set(leafId, {
      id: leafId,
      depth: leafDepth,
      kind: "leaf",
      label: parent?.label || path.branching_hint || path.path_id,
      leafIds: [path.path_id],
      tone: index % 5,
      target: path,
      path,
    });
    edges.push({ from: parent?.id || rootId, to: leafId });
  });

  const maxDepth = Math.max(1, ...[...nodes.values()].map((node) => node.depth));
  const pathOrder = new Map(paths.map((path, index) => [path.path_id, index]));
  const layers = new Map<number, FlatTreeNode[]>();
  nodes.forEach((node) => layers.set(node.depth, [...(layers.get(node.depth) ?? []), node]));
  const scoreNode = (node: FlatTreeNode) => {
    const indexes = node.leafIds.map((id) => pathOrder.get(id)).filter((value): value is number => value !== undefined);
    return indexes.length ? indexes.reduce((total, value) => total + value, 0) / indexes.length : 0;
  };
  layers.forEach((layer) => layer.sort((left, right) => scoreNode(left) - scoreNode(right)));

  const maxLayerSize = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const treeHeight = Math.max(96, Math.min(140, maxLayerSize * 21 + 12));
  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, depth) => {
    layer.forEach((node, index) => {
      positions.set(node.id, {
        x: 7 + (depth / maxDepth) * 61,
        y: layer.length === 1 ? 50 : 10 + (index / (layer.length - 1)) * 80,
      });
    });
  });

  return (
    <section className={`branch-map ${variant === "featured" ? "branch-map-featured" : ""}`} aria-label="Choose a final video path">
      <div className="branch-map-canvas branch-map-horizontal">
        <div className="flat-branch-tree" style={{ height: treeHeight }} role="tree" aria-label="Interactive video paths">
          <svg className="flat-tree-edges" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            {edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const middle = ((from.x + to.x) / 2) * 10;
              return (
                <path
                  d={`M ${from.x * 10} ${from.y * 10} C ${middle} ${from.y * 10}, ${middle} ${to.y * 10}, ${to.x * 10} ${to.y * 10}`}
                  key={`${edge.from}-${edge.to}`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {[...nodes.values()].map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            if (node.kind === "root") {
              return (
                <button
                  className="flat-tree-node branch-root-circle"
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  type="button"
                  onClick={onRestart}
                  aria-label="Play from the start"
                  key={node.id}
                >
                  <Play size={13} fill="currentColor" />
                </button>
              );
            }

            if (node.kind === "leaf" && node.path) {
              const selected = node.path.path_id === selectedLeafPathId;
              const active = node.path.path_id === activePathId;
              return (
                <button
                  className={`flat-tree-node branch-leaf tone-${node.tone} ${selected ? "is-selected" : ""} ${active ? "is-active" : ""}`}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  type="button"
                  onClick={() => onSelectLeaf(node.path!)}
                  aria-pressed={selected}
                  aria-label={`${selected ? "Locked path" : "Choose path"}: ${node.label}`}
                  key={node.id}
                >
                  {node.path.thumbnailUrl && <img src={node.path.thumbnailUrl} alt="" />}
                  <span className="branch-leaf-play"><Play size={12} fill="currentColor" /></span>
                  <span className="branch-leaf-end">{node.label}</span>
                </button>
              );
            }

            const selected = Boolean(selectedLeafPathId && node.leafIds.includes(selectedLeafPathId));
            return (
              <button
                className={`flat-tree-node branch-decision-node tone-${node.tone} ${selected ? "is-selected" : ""}`}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                type="button"
                onClick={() => node.target && onSelectLeaf(node.target)}
                disabled={!node.target}
                aria-label={node.label}
                aria-pressed={selected}
                key={node.id}
              >
                <span className="branch-node-dot" />
                <span className="branch-node-hover">
                  {node.target?.thumbnailUrl && <img src={node.target.thumbnailUrl} alt="" />}
                  <span><b>{node.label}</b></span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const InteractivePlayer = forwardRef<InteractivePlayerHandle, {
  publication: InteractivePublication;
  onClose: () => void;
  startPaused: boolean;
  initialLeafPathId?: string | null;
}>(function InteractivePlayer({ publication, onClose, startPaused, initialLeafPathId = null }, ref) {
  const isMobileLoading = useMobilePlayerLoading();
  const paths = publication.manifest.outputs.paths;
  const defaultPath =
    paths.find((path) => path.path_id === publication.manifest.default_path_id) ??
    paths.find((path) => path.is_default) ??
    paths[0];
  const initialLockedPathId = paths.some((path) => path.path_id === initialLeafPathId)
    ? initialLeafPathId
    : null;
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
  const [immersive, setImmersive] = useState(false);
  const [selectedLeafPathId, setSelectedLeafPathId] = useState<string | null>(initialLockedPathId);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const videoElementsRef = useRef(new Map<string, HTMLVideoElement>());
  const playerRef = useRef<HTMLDivElement>(null);
  const playerShellRef = useRef<HTMLDivElement>(null);
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
  const selectedLeafPathIdRef = useRef<string | null>(initialLockedPathId);
  const preloadedThumbnailUrlsRef = useRef(new Set<string>());
  const initialPlaybackRequestedRef = useRef(false);
  const fullscreenPlaybackRef = useRef<{ pathId: string; shouldResume: boolean } | null>(null);
  const activePath = paths.find((path) => path.path_id === activePathId) ?? defaultPath;

  useEffect(() => {
    selectedLeafPathIdRef.current = selectedLeafPathId;
  }, [selectedLeafPathId]);

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
    const selectedPath = paths.find((path) => path.path_id === selectedLeafPathId);
    return [activePath, ...bufferedPaths, ...(selectedPath ? [selectedPath] : [])]
      .filter((path, index, collection) => collection.findIndex((candidate) => candidate.path_id === path.path_id) === index);
  }, [activePath, bufferedPaths, paths, selectedLeafPathId]);

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

  const pauseInactiveVideos = useCallback((keepPathId: string) => {
    videoElementsRef.current.forEach((candidate, pathId) => {
      if (pathId !== keepPathId && !candidate.paused) candidate.pause();
    });
  }, []);

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
    const lockedPathId = selectedLeafPathIdRef.current;
    if (lockedPathId) {
      const option = choice.options.find((candidate) => candidate.leaf_path_ids.includes(lockedPathId));
      const target = option && pathForOption(
        option,
        paths,
        lockedPathId,
        publication.manifest.default_path_id,
      );
      if (!target) return;
      const resumeAt = choice.switch_at_seconds + 0.04;
      setHandledChoices((previous) => previous.includes(choice.branch_point_id)
        ? previous
        : [...previous, choice.branch_point_id]);
      setPendingChoice(null);
      setPreviewChoice(null);
      if (target.path_id === activePathId) {
        video.currentTime = resumeAt;
        void video.play().catch(() => undefined);
        return;
      }
      video.pause();
      resumeRef.current = {
        pathId: target.path_id,
        time: resumeAt,
        volume: video.volume,
        muted: video.muted,
        rate: video.playbackRate,
      };
      setSwitching(true);
      setActivePathId(target.path_id);
      const targetVideo = videoElementsRef.current.get(target.path_id);
      if (targetVideo && targetVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
        targetVideo.currentTime = Math.min(resumeAt, Math.max(targetVideo.duration - 0.1, 0));
        targetVideo.volume = video.volume;
        targetVideo.muted = video.muted;
        targetVideo.playbackRate = video.playbackRate;
        resumeRef.current = null;
        setDuration(Number.isFinite(targetVideo.duration) ? targetVideo.duration : target.duration);
        pauseInactiveVideos(target.path_id);
        void targetVideo.play().catch(() => {
          setPlaying(false);
          setSwitching(false);
        });
      }
      return;
    }
    updateChoiceAudioFade(video, choice.switch_at_seconds, choice.switch_at_seconds);
    video.currentTime = choice.switch_at_seconds;
    video.pause();
    setCurrentTime(choice.switch_at_seconds);
    setPreviewChoice(choice);
    setPendingChoice(choice);
  }, [activePathId, clearChoiceTransitionWatch, paths, pauseInactiveVideos, publication.manifest.default_path_id, updateChoiceAudioFade]);

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

  useLayoutEffect(() => {
    if (startPaused || initialPlaybackRequestedRef.current) return;
    initialPlaybackRequestedRef.current = true;
    void playWithSound();
  }, [playWithSound, startPaused]);

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
    window.addEventListener("scroll", revealControls, { passive: true });
    return () => window.removeEventListener("scroll", revealControls);
  }, [revealControls]);

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
    const routeIsLocked = Boolean(selectedLeafPathIdRef.current);
    const audioFadeAt = routeIsLocked
      ? switchAt
      : Math.max(0, switchAt - CHOICE_AUDIO_FADE_LEAD_SECONDS);
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
      if (!selectedLeafPathIdRef.current) setPreviewChoice(nextChoice);
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

    if (!routeIsLocked) {
      watch.audioFadeTimeoutId = window.setTimeout(startAudioFade, audioFadeDelay);
      watch.previewTimeoutId = window.setTimeout(showPreview, previewDelay);
    }
    watch.boundaryTimeoutId = window.setTimeout(stopAtBoundary, boundaryDelay);

    if (typeof video.requestVideoFrameCallback === "function") {
      const inspectFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (choiceTransitionWatchRef.current !== watch) return;
        const mediaTime = Math.max(metadata.mediaTime, video.currentTime);
        if (!routeIsLocked && mediaTime >= audioFadeAt) updateChoiceAudioFade(video, switchAt, mediaTime);
        if (mediaTime >= switchAt) {
          stopAtBoundary();
          return;
        }
        if (!routeIsLocked && mediaTime >= previewAt) showPreview();
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
    selectedLeafPathId,
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
      if (event.key === "Escape" && !document.fullscreenElement) {
        if (immersive) setImmersive(false);
        else onClose();
      }
      if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        void togglePlay();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [immersive, onClose, togglePlay]);

  const restoreFullscreenPlayback = useCallback(() => {
    const snapshot = fullscreenPlaybackRef.current;
    if (!snapshot) return;
    fullscreenPlaybackRef.current = null;
    if (!snapshot.shouldResume) return;

    const video = videoElementsRef.current.get(snapshot.pathId);
    if (!video || !video.paused) return;
    pauseInactiveVideos(snapshot.pathId);
    void video.play().catch(() => {
      setPlaying(false);
      setAwaitingStart(true);
    });
  }, [pauseInactiveVideos]);

  useEffect(() => {
    const syncFullscreen = () => {
      if (!document.fullscreenElement) setImmersive(false);
      restoreFullscreenPlayback();
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.body.classList.toggle("player-open", immersive);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.body.classList.remove("player-open");
    };
  }, [immersive, restoreFullscreenPlayback]);

  if (!activePath) return null;

  const handleTimeUpdate = (video: HTMLVideoElement, pathId: string) => {
    if (pathId !== activePathId) return;
    setCurrentTime(video.currentTime);
    if (nextChoice && !selectedLeafPathIdRef.current) {
      updateChoiceAudioFade(video, nextChoice.switch_at_seconds, video.currentTime);
    }
    if (nextChoice && video.currentTime >= nextChoice.switch_at_seconds) {
      presentChoiceAtBoundary(video, pathId, nextChoice);
    }
  };

  const applyBranchChoice = (
    choice: InteractivePublicationChoicePoint,
    option: InteractivePublicationChoiceOption,
  ) => {
    const video = getActiveVideo();
    const target = pathForOption(
      option,
      paths,
      selectedLeafPathIdRef.current || activePathId,
      publication.manifest.default_path_id,
    );
    if (!target || !video) return;

    const resumeAt = choice.switch_at_seconds + 0.04;
    const resumeVolume = restoreChoiceAudioVolume(video);
    clearChoiceTransitionWatch();
    presentedChoiceIdRef.current = null;
    setHandledChoices((previous) => previous.includes(choice.branch_point_id)
      ? previous
      : [...previous, choice.branch_point_id]);
    setPendingChoice(null);
    setPreviewChoice(null);

    if (target.path_id === activePathId) {
      video.currentTime = resumeAt;
      pauseInactiveVideos(activePathId);
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
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
      pauseInactiveVideos(target.path_id);
      void bufferedVideo.play().catch(() => {
        bufferedVideo.removeEventListener("playing", handlePlaying);
        setPlaying(false);
        setSwitching(false);
      });
    }
  };

  const chooseBranch = (option: InteractivePublicationChoiceOption) => {
    if (pendingChoice) applyBranchChoice(pendingChoice, option);
  };

  const selectLeafPath = (target: InteractivePublicationVideoPath) => {
    const video = getActiveVideo();
    const selectedPathId = target.path_id;
    selectedLeafPathIdRef.current = selectedPathId;
    setSelectedLeafPathId(selectedPathId);
    clearChoiceTransitionWatch();
    restoreChoiceAudioVolume(video);
    setPendingChoice(null);
    setPreviewChoice(null);
    presentedChoiceIdRef.current = null;

    const choicesSoFar = publication.manifest.tree.choice_points.filter(
      (choice) => choice.switch_at_seconds <= currentTime,
    );
    const routeIsAligned = choicesSoFar.every((choice) => {
      const currentOption = choice.options.find((option) => option.leaf_path_ids.includes(activePathId));
      const selectedOption = choice.options.find((option) => option.leaf_path_ids.includes(selectedPathId));
      return !currentOption || !selectedOption || currentOption.child_node_id === selectedOption.child_node_id;
    });

    if (activePathId === selectedPathId || routeIsAligned) {
      if (video) {
        setAwaitingStart(false);
        pauseInactiveVideos(activePathId);
        if (video.paused) void video.play().catch(() => setAwaitingStart(true));
      }
      return;
    }

    const lastDivergentParent = choicesSoFar
      .filter((choice) => {
        const currentOption = choice.options.find((option) => option.leaf_path_ids.includes(activePathId));
        const selectedOption = choice.options.find((option) => option.leaf_path_ids.includes(selectedPathId));
        return Boolean(currentOption && selectedOption && currentOption.child_node_id !== selectedOption.child_node_id);
      })
      .sort((left, right) => right.switch_at_seconds - left.switch_at_seconds)[0];
    const resumeAt = awaitingStart ? 0 : (lastDivergentParent?.switch_at_seconds ?? 0) + (lastDivergentParent ? 0.04 : 0);
    const resumeVolume = video?.volume ?? 1;
    video?.pause();
    setHandledChoices(
      publication.manifest.tree.choice_points
        .filter((choice) => choice.switch_at_seconds < resumeAt)
        .map((choice) => choice.branch_point_id),
    );
    resumeRef.current = {
      pathId: selectedPathId,
      time: resumeAt,
      volume: resumeVolume,
      muted: video?.muted ?? muted,
      rate: video?.playbackRate ?? playbackRate,
    };
    setSwitching(true);
    setAwaitingStart(false);
    setActivePathId(selectedPathId);
    const selectedVideo = videoElementsRef.current.get(selectedPathId);
    if (selectedVideo && selectedVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      selectedVideo.currentTime = Math.min(resumeAt, Math.max(selectedVideo.duration - 0.1, 0));
      selectedVideo.volume = resumeVolume;
      selectedVideo.muted = video?.muted ?? muted;
      selectedVideo.playbackRate = video?.playbackRate ?? playbackRate;
      resumeRef.current = null;
      setDuration(Number.isFinite(selectedVideo.duration) ? selectedVideo.duration : target.duration);
      pauseInactiveVideos(selectedPathId);
      void selectedVideo.play().catch(() => {
        setPlaying(false);
        setSwitching(false);
        setAwaitingStart(true);
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
      pauseInactiveVideos(path.path_id);
      void video.play().catch(() => {
        setPlaying(false);
        setSwitching(false);
      });
    }
  };

  const restart = () => {
    const video = getActiveVideo();
    const restartPath = defaultPath;
    const restartVolume = restoreChoiceAudioVolume(video);
    clearChoiceTransitionWatch();
    presentedChoiceIdRef.current = null;
    selectedLeafPathIdRef.current = null;
    setSelectedLeafPathId(null);
    setHandledChoices([]);
    setPendingChoice(null);
    setPreviewChoice(null);
    setAwaitingStart(false);
    if (activePathId !== restartPath.path_id) {
      video?.pause();
      resumeRef.current = {
        pathId: restartPath.path_id,
        time: 0,
        volume: restartVolume,
        muted,
        rate: playbackRate,
      };
      setSwitching(true);
      setActivePathId(restartPath.path_id);

      const bufferedDefault = videoElementsRef.current.get(restartPath.path_id);
      if (bufferedDefault && bufferedDefault.readyState >= HTMLMediaElement.HAVE_METADATA) {
        bufferedDefault.currentTime = 0;
        bufferedDefault.volume = restartVolume;
        bufferedDefault.muted = muted;
        bufferedDefault.playbackRate = playbackRate;
        resumeRef.current = null;
        setDuration(Number.isFinite(bufferedDefault.duration) ? bufferedDefault.duration : restartPath.duration);
        const handlePlaying = () => {
          setPlaying(true);
          setSwitching(false);
        };
        bufferedDefault.addEventListener("playing", handlePlaying, { once: true });
        pauseInactiveVideos(restartPath.path_id);
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
    if (nextChoice && !selectedLeafPathIdRef.current) {
      updateChoiceAudioFade(video, nextChoice.switch_at_seconds, value);
    }
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

  const toggleFullscreen = async () => {
    const video = getActiveVideo();
    fullscreenPlaybackRef.current = {
      pathId: activePathId,
      shouldResume: Boolean(video && !video.paused && !video.ended),
    };

    if (immersive) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setImmersive(false);
      restoreFullscreenPlayback();
      return;
    }

    setImmersive(true);
    await playerShellRef.current?.requestFullscreen().catch(() => undefined);
    restoreFullscreenPlayback();
  };

  const displayedChoice = selectedLeafPathId ? null : pendingChoice ?? previewChoice;
  const secondsUntilChoice = nextChoice
    ? nextChoice.switch_at_seconds - currentTime
    : Number.POSITIVE_INFINITY;
  const showChoicePrompt = Boolean(
    playing &&
    nextChoice &&
    !selectedLeafPathId &&
    !displayedChoice &&
    secondsUntilChoice <= CHOICE_PROMPT_LEAD_SECONDS &&
    secondsUntilChoice > CHOICE_FADE_LEAD_SECONDS,
  );

  return (
    <div
      className={`player-shell ${immersive ? "is-immersive" : "is-standard"} ${playing && !controlsVisible ? "is-idle-playing" : ""}`}
      ref={playerShellRef}
      onPointerMove={revealControls}
      aria-label={`Playing ${publication.title}`}
    >
      {!immersive && (
        <header className="site-header watch-header">
          <Link className="brand" href="/" aria-label="TMochiLearn home"><TMochiLearnLogo /></Link>
          <nav className="site-nav" aria-label="Main navigation">
            <Link href="/" aria-current="page">Watch</Link>
            <Link href="/learn">Explore</Link>
          </nav>
          <Link className="publish-button" href="/creator">
            <WandSparkles size={16} />
            Create
          </Link>
        </header>
      )}
      <div className="watch-content">
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
          {immersive && (
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label="Return to standard view"
            >
              <Minimize2 size={20} />
            </button>
          )}
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
                  pauseInactiveVideos(path.path_id);
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
            <button type="button" onClick={() => void toggleFullscreen()} aria-label={immersive ? "Return to standard view" : "Open immersive view"}>
              {immersive ? <Minimize2 size={19} /> : <Expand size={19} />}
            </button>
          </div>
        </div>
      </div>
      {!immersive && (
        <>
          <PublicationBranchTree
            publication={publication}
            activePathId={activePathId}
            selectedLeafPathId={selectedLeafPathId}
            onSelectLeaf={selectLeafPath}
            onRestart={restart}
          />
          <section className="watch-summary">
            <div>
              <h1>{publication.title}</h1>
            </div>
            <div className="watch-description">
              <p className={descriptionExpanded ? "is-expanded" : ""}>{publication.description}</p>
              {publication.description.length > 120 && (
                <button
                  type="button"
                  onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                  aria-expanded={descriptionExpanded}
                >
                  {descriptionExpanded ? "View less" : "View more"}
                </button>
              )}
            </div>
            <div className="watch-summary-meta">
              <span>@{publication.creatorHandle || "unknown"}</span>
              <span>{paths.length} final paths</span>
              <span>{formatTime(publication.duration)}</span>
            </div>
          </section>
        </>
      )}
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
  const [entryLeafPathId, setEntryLeafPathId] = useState<string | null>(null);
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
    setEntryLeafPathId(null);
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
    setEntryLeafPathId(null);
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
      const query = new URLSearchParams({ limit: isLearn ? "200" : "30" });
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

  useLayoutEffect(() => {
    if (!selected && !routeLoading) return;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, [routeLoading, selected]);

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
  const featuredDefaultPathId = featured
    ? featured.manifest.outputs.paths.find((path) => path.path_id === featured.manifest.default_path_id)?.path_id ??
      featured.manifest.outputs.paths.find((path) => path.is_default)?.path_id ??
      featured.manifest.outputs.paths[0]?.path_id ??
      ""
    : "";
  const hasSearch = Boolean(search.trim());
  const feedItems = hasSearch || selectedTopic
    ? filtered
    : isLearn
      ? filtered.filter((publication) => publication.id !== featured?.id)
      : filtered;

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
      setEntryLeafPathId(null);
      setRouteLoading(false);
      setRouteError(null);
      setSelected(publication);
    });
    void playerHandleRef.current?.playWithSound();
    window.history.pushState({ tmochiPlayer: true }, "", publicationPath(publication.id));
  }, []);

  const openPlayerAtPath = useCallback((
    publication: InteractivePublication,
    pathId: string | null,
  ) => {
    flushSync(() => {
      setPlayerEntry("internal");
      setEntryLeafPathId(pathId);
      setRouteLoading(false);
      setRouteError(null);
      setSelected(publication);
    });
    void playerHandleRef.current?.playWithSound();
    window.history.pushState(
      { tmochiPlayer: true, tmochiLeafPath: pathId },
      "",
      publicationPath(publication.id),
    );
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

  if (selected) {
    return (
      <main className="watch-page">
        <InteractivePlayer
          key={`${selected.id}:${entryLeafPathId ?? "default"}`}
          ref={playerHandleRef}
          publication={selected}
          onClose={closePlayer}
          startPaused={playerEntry === "direct"}
          initialLeafPathId={entryLeafPathId}
        />
      </main>
    );
  }

  if (routeLoading || routeError) {
    return (
      <main className="watch-page">
        <div className="player-route-state" role="status" aria-live="polite">
          {routeLoading ? <LoaderCircle size={28} /> : <Film size={30} />}
          <h1>{routeLoading ? "Loading interactive lesson" : "Lesson unavailable"}</h1>
          {routeError && <p>{routeError}</p>}
          {routeError && <button type="button" onClick={returnToLanding}>Back to lessons</button>}
        </div>
      </main>
    );
  }

  return (
    <main className={isLearn ? "learn-page" : undefined}>
      <header className={`site-header ${isLearn ? "learn-site-header" : ""}`}>
        <Link className="brand" href={isLearn ? "/" : "#top"} aria-label="TMochiLearn home">
          <TMochiLearnLogo />
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <Link href="/" aria-current={!isLearn ? "page" : undefined}>Watch</Link>
          <Link href="/learn" aria-current={isLearn ? "page" : undefined}>Explore</Link>
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
              <p>Discover lessons that respond to your decisions. Every choice opens a new way to understand the subject.</p>
            </div>
            <div className="learn-hero-mark" aria-hidden="true">
              <span>LEARN</span>
              <GitFork size={27} />
            </div>
          </section>

          <section className="learn-library" aria-label="Educational interactive content">
            <aside className="learn-sidebar">
              <span className="learn-sidebar-label">Browse topics</span>
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
          <section className={`featured-landing ${featured || loading ? "has-featured" : ""}`} id="top" aria-label="Featured interactive video">
            <div className="featured-media">
              {featured ? (
                <PublicationCard publication={featured} onPlay={openPlayer} featured prototype={isPrototype} />
              ) : loading ? (
                <div className="feature-placeholder featured-media-skeleton" aria-hidden="true">
                  <span className="featured-skeleton-play" />
                </div>
              ) : (
                <div className="feature-placeholder">
                  <Film size={28} />
                </div>
              )}
            </div>
            {featured && (
              <aside className="featured-landing-panel" aria-label="Choose how to watch the featured lesson">
                <FeaturedCtaCopy className="featured-desktop-copy" />
                <PublicationBranchTree
                  publication={featured}
                  activePathId={featuredDefaultPathId}
                  selectedLeafPathId={null}
                  onSelectLeaf={(path) => openPlayerAtPath(featured, path.path_id)}
                  onRestart={() => openPlayerAtPath(featured, null)}
                  variant="featured"
                />
              </aside>
            )}
            {!featured && loading && (
              <aside className="featured-landing-panel featured-panel-skeleton" aria-hidden="true">
                <div className="featured-skeleton-copy">
                  <span className="is-heading" />
                  <span className="is-heading is-short" />
                  <div>
                    <span />
                    <span />
                    <span className="is-short" />
                  </div>
                </div>
                <div className="featured-tree-skeleton">
                  <span className="featured-tree-skeleton-line" />
                  {[0, 1, 2, 3, 4].map((node) => <span className="featured-tree-skeleton-node" key={node} />)}
                </div>
              </aside>
            )}
          </section>
          {featured && (
            <div className="featured-title">
              <h1>{featured.title}</h1>
            </div>
          )}
          {!featured && loading && (
            <div className="featured-title featured-title-skeleton" aria-hidden="true"><span /></div>
          )}

          <section className="explore-section catalog-grid-section" id="explore">
            {error && <div className="catalog-state"><Film size={28} /><h3>Signal interrupted</h3><p>{error}</p><button type="button" onClick={() => void loadPublications()}>Try again</button></div>}
            {loading && (
              <div className="film-grid" aria-label="Loading films">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <article className="film-card film-card-skeleton" aria-hidden="true" key={item}>
                    <div className="film-skeleton" />
                    <div className="film-card-skeleton-copy"><span /><span /></div>
                  </article>
                ))}
              </div>
            )}
            {!loading && !error && feedItems.length > 0 && <div className="film-grid">{feedItems.map((publication) => <PublicationCard key={publication.id} publication={publication} onPlay={openPlayer} prototype={isPrototype} />)}</div>}
            {response?.hasMore && !search && <button className="load-more" type="button" disabled={loadingMore} onClick={() => response.nextCursor && void loadPublications(response.nextCursor)}>{loadingMore ? <LoaderCircle size={17} /> : <ChevronDown size={17} />}{loadingMore ? "Loading" : "Load more lessons"}</button>}
          </section>
        </>
      )}

      <footer>
        <div className="brand" role="img" aria-label="TMochiLearn"><TMochiLearnLogo /></div>
        <p>Interactive lessons, shaped by every choice.</p>
        <span>Powered by Samsar</span>
      </footer>

    </main>
  );
}
