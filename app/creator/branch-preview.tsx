"use client";

import { GitFork, Play, Shuffle } from "lucide-react";
import type {
  GlobalStatusDetailedResponse,
  NarrativeVideoBranchAudioTimelineItem,
  NarrativeVideoBranchPathStatus,
  NarrativeVideoBranchTimelineItem,
  VideoSessionPreviewAudioLayer,
  VideoSessionPreviewLayer,
} from "samsar-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "./creator.module.css";

export interface BranchPreviewProps {
  status: GlobalStatusDetailedResponse;
  selectedPathId?: string | null;
  onPathChange?: (pathId: string) => void;
}

type PreviewAsset = {
  kind: "image" | "video";
  url: string;
  includesAudio: boolean;
};

type PreviewScene = {
  key: string;
  sequenceIndex: number;
  sceneIndex?: number;
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  asset: PreviewAsset;
};

type PreviewAudioCue = {
  key: string;
  startTime: number;
  endTime: number;
  sourceTrimStartTime: number;
  volume: number;
  url: string;
};

type PlayablePath = {
  id: string;
  ordinal: number;
  isDefault: boolean;
  title: string;
  description?: string;
  scenes: PreviewScene[];
  audio: PreviewAudioCue[];
};

const DEFAULT_SCENE_DURATION = 4;

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveUrl(value: unknown): string | undefined {
  const direct = nonEmptyString(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = resolveUrl(item);
      if (url) return url;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of [
    "url",
    "remoteURL",
    "remoteUrl",
    "remote_url",
    "videoLink",
    "video_link",
    "src",
    "previewUrl",
    "preview_url",
    "signedUrl",
    "signed_url",
  ]) {
    const url = nonEmptyString(record[key]);
    if (url) return url;
  }
  return undefined;
}

function resolveLayerAsset(layer: VideoSessionPreviewLayer): PreviewAsset | undefined {
  const raw = layer as Record<string, unknown>;
  const preview = asRecord(layer.preview);
  const videoCandidates: unknown[] = [
    layer.lipSyncVideo,
    raw.lipSyncRemoteLink,
    raw.lipSyncVideoLayer,
    layer.soundEffectVideo,
    raw.soundEffectRemoteLink,
    raw.soundEffectVideoLayer,
    layer.aiVideo,
    raw.aiVideoRemoteLink,
    raw.aiVideoLayer,
    layer.userVideo,
    raw.userVideoRemoteLink,
    raw.userVideoLayer,
    preview?.type === "video" ? preview : undefined,
  ];

  for (const candidate of videoCandidates) {
    const url = resolveUrl(candidate);
    if (url) return { kind: "video", url, includesAudio: false };
  }

  const frameImages = asRecord(raw.frameImages);
  const image = asRecord(layer.image);
  const imageCandidates: unknown[] = [
    frameImages?.startFrameUrl,
    frameImages?.startFrame,
    frameImages?.aiLayerStartFrame,
    frameImages?.baseLayerStartFrame,
    frameImages?.aiVideoThumbnailPath,
    frameImages?.thumbnailPath,
    raw.aiLayerStartFrame,
    raw.baseLayerStartFrame,
    raw.aiVideoThumbnailPath,
    raw.thumbnailPath,
    raw.editedImage,
    preview?.type !== "video" ? preview : undefined,
    image,
  ];

  for (const candidate of imageCandidates) {
    const url = resolveUrl(candidate);
    if (url) return { kind: "image", url, includesAudio: false };
  }
  return undefined;
}

function layerForTimelineItem(
  item: NarrativeVideoBranchTimelineItem,
  layers: VideoSessionPreviewLayer[],
  layersById: Map<string, VideoSessionPreviewLayer>,
): VideoSessionPreviewLayer | undefined {
  const layerId = nonEmptyString(item.layer_id);
  if (layerId) {
    const byId = layersById.get(layerId);
    if (byId) return byId;
  }

  if (typeof item.scene_index === "number") {
    return layers.find((layer) => layer.index === item.scene_index);
  }
  return layers[item.sequence_index];
}

function audioLayerForTimelineItem(
  item: NarrativeVideoBranchAudioTimelineItem,
  layers: VideoSessionPreviewAudioLayer[],
  layersById: Map<string, VideoSessionPreviewAudioLayer>,
): VideoSessionPreviewAudioLayer | undefined {
  const layerId = nonEmptyString(item.audio_layer_id);
  if (layerId) {
    const byId = layersById.get(layerId);
    if (byId) return byId;
  }

  if (typeof item.connected_layer_index === "number") {
    const connected = layers.find(
      (layer) => layer.connectedLayerIndex === item.connected_layer_index,
    );
    if (connected) return connected;
  }
  return layers[item.sequence_index];
}

function resolveEndTime(
  startTime: number,
  endTime: unknown,
  duration: unknown,
  fallbackDuration = DEFAULT_SCENE_DURATION,
): number {
  const explicitEnd = finiteNumber(endTime);
  if (explicitEnd !== undefined && explicitEnd > startTime) return explicitEnd;
  return startTime + Math.max(0.2, finiteNumber(duration) ?? fallbackDuration);
}

function normalizeVolume(value: unknown): number {
  const volume = finiteNumber(value) ?? 1;
  return Math.max(0, Math.min(1, volume > 1 ? volume / 100 : volume));
}

function materializeDiagnosticPath(
  path: NarrativeVideoBranchPathStatus,
  layers: VideoSessionPreviewLayer[],
  audioLayers: VideoSessionPreviewAudioLayer[],
): PlayablePath | undefined {
  const layersById = new Map<string, VideoSessionPreviewLayer>();
  layers.forEach((layer) => {
    const id = nonEmptyString(layer.id);
    if (id) layersById.set(id, layer);
  });

  const audioLayersById = new Map<string, VideoSessionPreviewAudioLayer>();
  audioLayers.forEach((layer) => {
    const id = nonEmptyString(layer.id);
    if (id) audioLayersById.set(id, layer);
  });

  const timeline = [...(path.timeline ?? [])].sort(
    (left, right) => left.sequence_index - right.sequence_index,
  );
  const scenes = timeline.flatMap((item): PreviewScene[] => {
    const layer = layerForTimelineItem(item, layers, layersById);
    if (!layer) return [];
    const asset = resolveLayerAsset(layer);
    if (!asset) return [];

    const startTime = Math.max(
      0,
      finiteNumber(item.start_time) ?? finiteNumber(layer.startTime) ?? 0,
    );
    const endTime = resolveEndTime(
      startTime,
      item.end_time ?? layer.endTime,
      item.duration ?? layer.duration,
    );
    const layerId = nonEmptyString(item.layer_id) ?? nonEmptyString(layer.id);

    return [
      {
        key: `${path.path_id}:${item.sequence_index}:${layerId ?? layer.index}`,
        sequenceIndex: item.sequence_index,
        sceneIndex: item.scene_index,
        startTime,
        endTime,
        duration: endTime - startTime,
        title: nonEmptyString(layer.prompt) ?? `Scene ${item.sequence_index + 1}`,
        asset,
      },
    ];
  });

  const finalPathUrl =
    nonEmptyString(path.result_url) ??
    nonEmptyString(path.video_link) ??
    nonEmptyString(path.remote_url);
  let usesRenderedPath = false;
  if (scenes.length === 0 && finalPathUrl) {
    usesRenderedPath = true;
    const duration = Math.max(0.2, finiteNumber(path.duration) ?? DEFAULT_SCENE_DURATION);
    scenes.push({
      key: `${path.path_id}:rendered`,
      sequenceIndex: 0,
      startTime: 0,
      endTime: duration,
      duration,
      title: nonEmptyString(path.branching_hint) ?? "Rendered path",
      asset: { kind: "video", url: finalPathUrl, includesAudio: true },
    });
  }
  if (scenes.length === 0) return undefined;

  const audioTimeline = [...(path.audio_timeline ?? [])].sort(
    (left, right) => left.sequence_index - right.sequence_index,
  );
  const audio = (usesRenderedPath ? [] : audioTimeline).flatMap((item): PreviewAudioCue[] => {
    const layer = audioLayerForTimelineItem(item, audioLayers, audioLayersById);
    if (!layer) return [];
    const hasSelectionState =
      typeof layer.isEnabled === "boolean" || typeof layer.defaultSelected === "boolean";
    if (hasSelectionState && !layer.isEnabled && !layer.defaultSelected) return [];
    const layerStatus = nonEmptyString(layer.status)?.toUpperCase();
    if (layerStatus === "PENDING" || layerStatus === "FAILED") return [];
    const url = resolveUrl(layer.url) ?? resolveUrl(layer.remoteAudioLinks);
    if (!url) return [];

    const startTime = Math.max(
      0,
      finiteNumber(item.start_time) ?? finiteNumber(layer.startTime) ?? 0,
    );
    const endTime = resolveEndTime(
      startTime,
      item.end_time ?? layer.endTime,
      item.duration ?? layer.duration,
    );
    const audioLayerId = nonEmptyString(item.audio_layer_id) ?? nonEmptyString(layer.id);

    return [
      {
        key: `${path.path_id}:audio:${item.sequence_index}:${audioLayerId ?? layer.index}`,
        startTime,
        endTime,
        sourceTrimStartTime: Math.max(0, finiteNumber(layer.sourceTrimStartTime) ?? 0),
        volume: normalizeVolume(layer.volume),
        url,
      },
    ];
  });

  const lastSelection = path.selection_trail.at(-1);
  return {
    id: path.path_id,
    ordinal: path.ordinal,
    isDefault: path.is_default,
    title:
      nonEmptyString(path.branching_hint) ??
      nonEmptyString(lastSelection?.path_name) ??
      `Path ${path.ordinal + 1}`,
    description:
      nonEmptyString(path.branching_description) ??
      nonEmptyString(lastSelection?.path_description),
    scenes,
    audio,
  };
}

function materializePaths(status: GlobalStatusDetailedResponse): PlayablePath[] {
  // Keep the preview resilient during the brief hand-off between creation and first poll.
  if (!status) return [];
  const session = status.session;
  const layers = session?.layers ?? [];
  const audioLayers = [
    ...(session?.audioLayers ?? []),
    ...(session?.globalAudioLayers ?? []),
  ];
  const diagnosticPaths = session?.branching?.paths ?? status.branching?.paths ?? [];
  const paths = diagnosticPaths.flatMap((path): PlayablePath[] => {
    const playable = materializeDiagnosticPath(path, layers, audioLayers);
    return playable ? [playable] : [];
  });

  if (paths.length > 0 || status.branching?.outputs.ready !== true) return paths;

  return status.branching.outputs.paths.flatMap((path, index): PlayablePath[] => {
    const url = nonEmptyString(path.url);
    if (!url) return [];
    const duration = Math.max(0.2, finiteNumber(path.duration) ?? DEFAULT_SCENE_DURATION);
    return [
      {
        id: path.path_id,
        ordinal: path.ordinal ?? index,
        isDefault: path.is_default,
        title: nonEmptyString(path.branching_hint) ?? `Path ${index + 1}`,
        description: nonEmptyString(path.branching_description),
        scenes: [
          {
            key: `${path.path_id}:output`,
            sequenceIndex: 0,
            startTime: 0,
            endTime: duration,
            duration,
            title: nonEmptyString(path.branching_hint) ?? `Path ${index + 1}`,
            asset: { kind: "video", url, includesAudio: true },
          },
        ],
        audio: [],
      },
    ];
  });
}

function audioCueOverlapsScene(cue: PreviewAudioCue, scene: PreviewScene): boolean {
  return cue.startTime < scene.endTime && cue.endTime > scene.startTime;
}

function chooseRandomPath(paths: PlayablePath[], previousId?: string): PlayablePath | undefined {
  if (paths.length === 0) return undefined;
  const pool = paths.length > 1 ? paths.filter((path) => path.id !== previousId) : paths;
  return pool[Math.floor(Math.random() * pool.length)];
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export function BranchPreview({
  status,
  selectedPathId,
  onPathChange,
}: BranchPreviewProps) {
  const playablePaths = useMemo(() => materializePaths(status), [status]);
  const preferredPath =
    playablePaths.find((path) => path.id === selectedPathId) ??
    playablePaths.find((path) => path.isDefault) ??
    playablePaths[0];
  const [activePathId, setActivePathId] = useState("");
  const [playbackPath, setPlaybackPath] = useState<PlayablePath | null>(null);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRun, setPlaybackRun] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const activePath =
    (isPlaying ? playbackPath : undefined) ??
    playablePaths.find((path) => path.id === selectedPathId) ??
    playablePaths.find((path) => path.id === activePathId) ??
    preferredPath;
  const displayedSceneIndex = isPlaying ? activeSceneIndex : 0;
  const activeScene =
    activePath?.scenes[displayedSceneIndex] ?? activePath?.scenes[0];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());

  const stopMedia = useCallback(() => {
    videoRef.current?.pause();
    audioRefs.current.forEach((audio) => audio.pause());
  }, []);

  const registerAudio = useCallback((key: string, element: HTMLAudioElement | null) => {
    if (element) audioRefs.current.set(key, element);
    else audioRefs.current.delete(key);
  }, []);

  const startPreview = useCallback(() => {
    const nextPath = chooseRandomPath(playablePaths, playbackPath?.id);
    if (!nextPath) return;

    stopMedia();
    // Prime every audio element inside the click gesture so later scene cues can play.
    nextPath.audio.forEach((cue) => {
      const audio = audioRefs.current.get(cue.key);
      if (!audio) return;
      audio.muted = true;
      const primeAttempt = audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      void primeAttempt.catch(() => undefined);
    });

    setActivePathId(nextPath.id);
    setPlaybackPath(nextPath);
    setActiveSceneIndex(0);
    setPlaybackRun((run) => run + 1);
    setPlaybackNotice(null);
    setIsPlaying(true);
    onPathChange?.(nextPath.id);
  }, [onPathChange, playablePaths, playbackPath?.id, stopMedia]);

  useEffect(() => {
    if (!isPlaying || !activePath || !activeScene) return undefined;
    const audioElements = new Map(audioRefs.current);
    const video = videoRef.current;
    const image = imageRef.current;
    const overlappingCues = activePath.audio.filter((cue) =>
      audioCueOverlapsScene(cue, activeScene),
    );
    const pendingCuePlays = new Set<string>();
    const blockedCuePlays = new Set<string>();
    let animationFrame = 0;
    let disposed = false;
    let sceneFinished = false;
    let imageElapsed = 0;
    let previousImageTick: number | null = null;

    const pauseCues = () => {
      overlappingCues.forEach((cue) => audioElements.get(cue.key)?.pause());
    };

    const finishScene = () => {
      if (disposed || sceneFinished) return;
      sceneFinished = true;
      pauseCues();
      setActiveSceneIndex((currentIndex) => {
        if (currentIndex + 1 < activePath.scenes.length) return currentIndex + 1;
        setIsPlaying(false);
        return currentIndex;
      });
    };

    const failPlayback = (message: string) => {
      if (disposed) return;
      pauseCues();
      setPlaybackNotice(message);
      setIsPlaying(false);
    };

    const synchronizeAudio = (elapsed: number) => {
      const pathTime = activeScene.startTime + elapsed;

      overlappingCues.forEach((cue) => {
        const audio = audioElements.get(cue.key);
        if (!audio) return;

        if (pathTime + 0.02 < cue.startTime || pathTime >= cue.endTime - 0.02) {
          if (!audio.paused) audio.pause();
          return;
        }

        const expectedTime =
          cue.sourceTrimStartTime + Math.max(0, pathTime - cue.startTime);
        if (Math.abs(audio.currentTime - expectedTime) > 0.4) {
          try {
            audio.currentTime = expectedTime;
          } catch {
            // Metadata may still be loading; the next frame will retry the seek.
          }
        }
        audio.muted = false;
        audio.volume = cue.volume;

        if (
          audio.paused &&
          !audio.ended &&
          !pendingCuePlays.has(cue.key) &&
          !blockedCuePlays.has(cue.key)
        ) {
          pendingCuePlays.add(cue.key);
          void audio.play().then(
            () => {
              pendingCuePlays.delete(cue.key);
              if (disposed) audio.pause();
            },
            () => {
              pendingCuePlays.delete(cue.key);
              blockedCuePlays.add(cue.key);
            },
          );
        }
      });
    };

    const tick = (now: number) => {
      if (disposed || sceneFinished) return;

      let elapsed: number;
      if (activeScene.asset.kind === "video") {
        if (!video || video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          pauseCues();
          animationFrame = window.requestAnimationFrame(tick);
          return;
        }
        // A video's own media clock stops during buffering and follows user seeks.
        elapsed = Math.max(0, video.currentTime);
      } else {
        if (document.visibilityState !== "visible") {
          previousImageTick = now;
          pauseCues();
          animationFrame = window.requestAnimationFrame(tick);
          return;
        }
        if (previousImageTick !== null) {
          imageElapsed += Math.max(0, now - previousImageTick) / 1_000;
        }
        previousImageTick = now;
        elapsed = imageElapsed;
      }

      synchronizeAudio(elapsed);
      if (elapsed + 0.02 >= activeScene.duration) {
        finishScene();
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    const beginImagePlayback = () => {
      if (disposed || animationFrame) return;
      previousImageTick = performance.now();
      animationFrame = window.requestAnimationFrame(tick);
    };

    const handleVisibilityChange = () => {
      previousImageTick = performance.now();
      if (document.visibilityState !== "visible") pauseCues();
    };

    const handleVideoPlaying = () => {
      if (!disposed) setPlaybackNotice(null);
    };
    const handleVideoWaiting = () => pauseCues();
    const handleVideoEnded = () => finishScene();
    const handleVideoError = () =>
      failPlayback("This preview asset could not be played. Try another preview run.");
    const handleImageError = () =>
      failPlayback("This preview image could not be loaded. Try another preview run.");

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (activeScene.asset.kind === "video" && video) {
      video.addEventListener("playing", handleVideoPlaying);
      video.addEventListener("waiting", handleVideoWaiting);
      video.addEventListener("stalled", handleVideoWaiting);
      video.addEventListener("pause", handleVideoWaiting);
      video.addEventListener("ended", handleVideoEnded);
      video.addEventListener("error", handleVideoError);
      try {
        video.currentTime = 0;
      } catch {
        // The media clock will start at zero once metadata is available.
      }
      video.muted = !activeScene.asset.includesAudio;
      animationFrame = window.requestAnimationFrame(tick);
      void video.play().catch(() => {
        failPlayback("Playback was blocked. Press play preview to try again.");
      });
    } else if (activeScene.asset.kind === "image" && image) {
      image.addEventListener("load", beginImagePlayback);
      image.addEventListener("error", handleImageError);
      if (image.complete) {
        if (image.naturalWidth > 0) beginImagePlayback();
        else handleImageError();
      }
    } else {
      failPlayback("Preview media is not ready yet. Try again in a moment.");
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      video?.removeEventListener("playing", handleVideoPlaying);
      video?.removeEventListener("waiting", handleVideoWaiting);
      video?.removeEventListener("stalled", handleVideoWaiting);
      video?.removeEventListener("pause", handleVideoWaiting);
      video?.removeEventListener("ended", handleVideoEnded);
      video?.removeEventListener("error", handleVideoError);
      image?.removeEventListener("load", beginImagePlayback);
      image?.removeEventListener("error", handleImageError);
      video?.pause();
      pauseCues();
    };
  }, [activePath, activeScene, isPlaying, playbackRun]);

  useEffect(() => stopMedia, [stopMedia]);

  const totalDuration = activePath?.scenes.reduce((sum, scene) => sum + scene.duration, 0) ?? 0;

  return (
    <section className={styles.previewStage} aria-label="Interactive session preview">
      {activeScene ? (
        activeScene.asset.kind === "video" ? (
          <video
            key={`${playbackRun}:${activeScene.key}:${activeScene.asset.url}`}
            ref={videoRef}
            className={styles.previewMedia}
            src={activeScene.asset.url}
            playsInline
            preload="auto"
            controls={activeScene.asset.includesAudio}
          />
        ) : (
          // The media URL is generated at runtime, so Next Image cannot safely optimize it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${playbackRun}:${activeScene.key}:${activeScene.asset.url}`}
            ref={imageRef}
            className={styles.previewMedia}
            src={activeScene.asset.url}
            alt={activeScene.title}
          />
        )
      ) : (
        <div className={styles.previewMedia} role="status">
          Preview media will appear here as each branch is generated.
        </div>
      )}

      <div className={styles.previewOverlay}>
        {!isPlaying && (
          <button
            type="button"
            className={styles.previewButton}
            onClick={startPreview}
            disabled={playablePaths.length === 0}
          >
            {playablePaths.length > 1 ? <Shuffle size={16} /> : <Play size={16} fill="currentColor" />}
            {playablePaths.length === 0
              ? "Waiting for playable scenes"
              : playbackNotice
                ? "Retry preview"
                : "Play preview"}
          </button>
        )}
      </div>

      <div className={styles.previewMeta} aria-live="polite">
        <span>
          <GitFork size={14} /> {activePath?.title ?? "Building branch previews"}
        </span>
        {activePath && (
          <span>
            {playbackNotice && !isPlaying
              ? playbackNotice
              : isPlaying
              ? `Scene ${Math.min(displayedSceneIndex + 1, activePath.scenes.length)} of ${activePath.scenes.length}`
              : `${activePath.scenes.length} scene${activePath.scenes.length === 1 ? "" : "s"}`} · {formatDuration(totalDuration)}
          </span>
        )}
      </div>

      {playablePaths.flatMap((path) =>
        path.audio.map((cue) => (
          <audio
            key={cue.key}
            ref={(element) => registerAudio(cue.key, element)}
            className={styles.previewAudio}
            src={cue.url}
            preload="auto"
          />
        )),
      )}
    </section>
  );
}

export default BranchPreview;
