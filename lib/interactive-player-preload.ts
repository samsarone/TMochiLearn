import type {
  InteractivePublicationChoiceOption,
  InteractivePublicationChoicePoint,
  InteractivePublicationVideoPath,
} from "samsar-js";

export const pathForOption = (
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

export const getBufferedInteractiveVideoPaths = ({
  activePathId,
  defaultPathId,
  isMobileLoading,
  nextChoice,
  paths,
  selectedLeafPathId,
}: {
  activePathId: string;
  defaultPathId: string;
  isMobileLoading: boolean;
  nextChoice?: InteractivePublicationChoicePoint;
  paths: InteractivePublicationVideoPath[];
  selectedLeafPathId: string | null;
}) => {
  if (!nextChoice) return [];

  // A locked route has exactly one useful branch asset. Load it even on mobile
  // so automatic transitions do not wait for the selected leaf video.
  if (selectedLeafPathId) {
    const selectedOption = nextChoice.options.find((option) =>
      option.leaf_path_ids.includes(selectedLeafPathId),
    );
    const selectedNextPath = selectedOption && pathForOption(
      selectedOption,
      paths,
      selectedLeafPathId,
      defaultPathId,
    );
    return selectedNextPath && selectedNextPath.path_id !== activePathId
      ? [selectedNextPath]
      : [];
  }

  // Preserve the existing unlocked-route policy: desktop buffers the next
  // alternatives while mobile waits for a choice to avoid speculative video IO.
  if (isMobileLoading) return [];
  const candidates = nextChoice.options
    .map((option) => pathForOption(option, paths, activePathId, defaultPathId))
    .filter((path): path is InteractivePublicationVideoPath => Boolean(path));
  return candidates
    .filter((path, index) =>
      path.path_id !== activePathId &&
      candidates.findIndex((candidate) => candidate.path_id === path.path_id) === index,
    )
    .slice(0, 2);
};

export const getMountedInteractiveVideoPaths = ({
  activePath,
  bufferedPaths,
  paths,
  selectedLeafPathId,
}: {
  activePath?: InteractivePublicationVideoPath;
  bufferedPaths: InteractivePublicationVideoPath[];
  paths: InteractivePublicationVideoPath[];
  selectedLeafPathId: string | null;
}) => {
  if (!activePath) return bufferedPaths;
  const selectedPath = paths.find((path) => path.path_id === selectedLeafPathId);
  return [activePath, ...bufferedPaths, ...(selectedPath ? [selectedPath] : [])]
    .filter((path, index, collection) =>
      collection.findIndex((candidate) => candidate.path_id === path.path_id) === index,
    );
};

export const getInteractiveVideoPreloadMode = ({
  isActive,
  isMobileLoading,
  pathId,
  selectedLeafPathId,
}: {
  isActive: boolean;
  isMobileLoading: boolean;
  pathId: string;
  selectedLeafPathId: string | null;
}): "auto" | "none" => (
  isActive || pathId === selectedLeafPathId || !isMobileLoading ? "auto" : "none"
);

export const shouldCacheNextChoiceThumbnails = ({
  hasNextChoice,
  isMobileLoading,
  leadSeconds,
  playing,
  secondsUntilChoice,
  selectedLeafPathId,
}: {
  hasNextChoice: boolean;
  isMobileLoading: boolean;
  leadSeconds: number;
  playing: boolean;
  secondsUntilChoice: number;
  selectedLeafPathId: string | null;
}) => (
  hasNextChoice &&
  !selectedLeafPathId &&
  (!isMobileLoading || playing) &&
  secondsUntilChoice <= leadSeconds
);
