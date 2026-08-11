import assert from "node:assert/strict";
import test from "node:test";

const {
  getBufferedInteractiveVideoPaths,
  getInteractiveVideoPreloadMode,
  getMountedInteractiveVideoPaths,
  shouldCacheNextChoiceThumbnails,
} = await import(new URL("../lib/interactive-player-preload.ts", import.meta.url));

const path = (pathId, ordinal) => ({
  path_id: pathId,
  contentUrl: `https://media.example/${pathId}.mp4`,
  encodingFormat: "video/mp4",
  duration: 30,
  ordinal,
});

const paths = [
  path("default-leaf", 1),
  path("chosen-leaf", 2),
  path("alternate-leaf", 3),
  path("third-leaf", 4),
];

const nextChoice = {
  branch_point_id: "choice-1",
  parent_node_id: "root",
  switch_at_seconds: 10,
  options: [
    { child_node_id: "default", leaf_path_ids: ["default-leaf"] },
    { child_node_id: "chosen", leaf_path_ids: ["alternate-leaf", "chosen-leaf"] },
    { child_node_id: "third", leaf_path_ids: ["third-leaf"] },
  ],
};

const bufferedPaths = (overrides = {}) => getBufferedInteractiveVideoPaths({
  activePathId: "default-leaf",
  defaultPathId: "default-leaf",
  isMobileLoading: false,
  nextChoice,
  paths,
  selectedLeafPathId: null,
  ...overrides,
});

test("a prechosen route buffers only its next leaf video, including on mobile", () => {
  const result = bufferedPaths({
    isMobileLoading: true,
    selectedLeafPathId: "chosen-leaf",
  });

  assert.deepEqual(result.map(({ path_id }) => path_id), ["chosen-leaf"]);
});

test("a prechosen leaf is mounted immediately and receives eager video preload", () => {
  const mounted = getMountedInteractiveVideoPaths({
    activePath: paths[0],
    bufferedPaths: [],
    paths,
    selectedLeafPathId: "chosen-leaf",
  });

  assert.deepEqual(mounted.map(({ path_id }) => path_id), ["default-leaf", "chosen-leaf"]);
  assert.equal(getInteractiveVideoPreloadMode({
    isActive: false,
    isMobileLoading: true,
    pathId: "chosen-leaf",
    selectedLeafPathId: "chosen-leaf",
  }), "auto");
  assert.equal(getInteractiveVideoPreloadMode({
    isActive: false,
    isMobileLoading: true,
    pathId: "alternate-leaf",
    selectedLeafPathId: "chosen-leaf",
  }), "none");
});

test("an already-active selected leaf is not mounted or buffered twice", () => {
  assert.deepEqual(bufferedPaths({
    activePathId: "chosen-leaf",
    selectedLeafPathId: "chosen-leaf",
  }), []);

  const mounted = getMountedInteractiveVideoPaths({
    activePath: paths[1],
    bufferedPaths: [paths[1]],
    paths,
    selectedLeafPathId: "chosen-leaf",
  });
  assert.deepEqual(mounted.map(({ path_id }) => path_id), ["chosen-leaf"]);
});

test("no selection or a reset preserves speculative next-video caching", () => {
  const unlocked = bufferedPaths({ selectedLeafPathId: null });
  assert.deepEqual(
    unlocked.map(({ path_id }) => path_id),
    ["chosen-leaf", "third-leaf"],
  );
  assert.equal(getInteractiveVideoPreloadMode({
    isActive: false,
    isMobileLoading: false,
    pathId: "chosen-leaf",
    selectedLeafPathId: null,
  }), "auto");

  // The reset policy remains conservative on mobile until the viewer chooses.
  assert.deepEqual(bufferedPaths({
    isMobileLoading: true,
    selectedLeafPathId: null,
  }), []);
});

test("next-choice thumbnails remain cached only for unlocked or reset playback", () => {
  const base = {
    hasNextChoice: true,
    isMobileLoading: false,
    leadSeconds: 5,
    playing: true,
    secondsUntilChoice: 4,
  };

  assert.equal(shouldCacheNextChoiceThumbnails({
    ...base,
    selectedLeafPathId: "chosen-leaf",
  }), false);
  assert.equal(shouldCacheNextChoiceThumbnails({
    ...base,
    selectedLeafPathId: null,
  }), true);
  assert.equal(shouldCacheNextChoiceThumbnails({
    ...base,
    secondsUntilChoice: 6,
    selectedLeafPathId: null,
  }), false);
});
