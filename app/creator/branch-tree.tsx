"use client";

import type { NarrativeVideoBranchingStatus } from "samsar-js";
import type { ReactNode } from "react";

import styles from "./creator.module.css";

type BranchTreeProps = {
  branching: NarrativeVideoBranchingStatus | null;
  activePathId?: string | null;
};

type ChoicePoint = NonNullable<
  NarrativeVideoBranchingStatus["tree"]["choice_points"]
>[number];
type ChoiceOption = ChoicePoint["options"][number];

type Branch = {
  key: string;
  parentId: string;
  nodeId: string;
  point: ChoicePoint;
  option: ChoiceOption;
  optionIndex: number;
};

type PathProgress = {
  pathId: string;
  leafNodeId?: string;
  nodeIds: string[];
  status: string;
  selectionTrail: Array<{
    branchPointId?: string;
    nodeId?: string;
    parentNodeId?: string;
    branchOrdinal?: number;
  }>;
};

type NodeStatus = {
  label: string;
  tone: "ready" | "pending" | "paused" | "failed" | "cancelled";
};

const READY_STATUSES = new Set(["COMPLETED", "READY", "SUCCEEDED", "SUCCESS"]);
const FAILED_STATUSES = new Set(["FAILED", "ERROR"]);
const CANCELLED_STATUSES = new Set(["CANCELLED", "CANCELED"]);

const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const normalizedStatus = (value: string | undefined) =>
  (value ?? "PENDING").trim().toUpperCase();

const distinct = (values: Array<string | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const edgeKey = (parentId: string, nodeId: string) => `${parentId}\u0000${nodeId}`;

const pathCountLabel = (count: number) => `${count} ${count === 1 ? "path" : "paths"}`;

const safeLabel = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const statusForPaths = (
  paths: PathProgress[],
  fallbackStatus: string,
): NodeStatus => {
  const statuses = paths.map((path) => normalizedStatus(path.status));
  const readyCount = statuses.filter((status) => READY_STATUSES.has(status)).length;
  const failedCount = statuses.filter((status) => FAILED_STATUSES.has(status)).length;
  const cancelledCount = statuses.filter((status) => CANCELLED_STATUSES.has(status)).length;

  if (statuses.length > 0) {
    if (readyCount === statuses.length) return { label: "Ready", tone: "ready" };
    if (failedCount > 0) {
      return {
        label: failedCount === statuses.length ? "Failed" : "Needs attention",
        tone: "failed",
      };
    }
    if (cancelledCount === statuses.length) return { label: "Cancelled", tone: "cancelled" };
    if (statuses.every((status) => status === "PAUSED")) {
      return { label: "Paused", tone: "paused" };
    }
    if (readyCount > 0) {
      return { label: `${readyCount}/${statuses.length} ready`, tone: "pending" };
    }
    return { label: "Rendering", tone: "pending" };
  }

  const status = normalizedStatus(fallbackStatus);
  if (READY_STATUSES.has(status)) return { label: "Ready", tone: "ready" };
  if (FAILED_STATUSES.has(status)) return { label: "Failed", tone: "failed" };
  if (CANCELLED_STATUSES.has(status)) return { label: "Cancelled", tone: "cancelled" };
  if (status === "PAUSED") return { label: "Paused", tone: "paused" };
  if (status === "INIT") return { label: "Queued", tone: "pending" };
  return { label: "Rendering", tone: "pending" };
};

export function BranchTree({ branching, activePathId = null }: BranchTreeProps) {
  if (!branching) {
    return (
      <div className={styles.branchTreeScroller}>
        <div className={classNames(styles.branchTree, styles.branchTreeEmpty)} role="status">
          <div className={styles.branchNode}>
            <div className={styles.branchNodeCard}>
              <span className={styles.branchNodeKicker}>Branch map</span>
              <strong className={styles.branchNodeTitle}>Preparing story structure</strong>
              <p className={styles.branchNodeDescription}>
                Paths will appear here when the generation plan is ready.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const choicePoints = branching.tree.choice_points ?? [];
  const rootNodeId =
    safeLabel(branching.tree.root_node_id) ??
    choicePoints.map((point) => safeLabel(point.parent_node_id)).find(Boolean) ??
    "root";
  const branchesByParent = new Map<string, Branch[]>();
  const incomingLeafIds = new Map<string, Set<string>>();

  choicePoints.forEach((point, pointIndex) => {
    const parentId = safeLabel(point.parent_node_id) ?? rootNodeId;
    const branches = branchesByParent.get(parentId) ?? [];

    point.options.forEach((option, optionIndex) => {
      const nodeId =
        safeLabel(option.child_node_id) ??
        `${parentId}:branch-${pointIndex + 1}-${optionIndex + 1}`;
      const branch: Branch = {
        key: `${safeLabel(point.branch_point_id) ?? `${parentId}-${pointIndex}`}-${nodeId}-${optionIndex}`,
        parentId,
        nodeId,
        point,
        option,
        optionIndex,
      };
      branches.push(branch);

      const leafIds = incomingLeafIds.get(nodeId) ?? new Set<string>();
      (option.leaf_path_ids ?? []).forEach((pathId) => {
        if (safeLabel(pathId)) leafIds.add(pathId);
      });
      incomingLeafIds.set(nodeId, leafIds);
    });

    branchesByParent.set(parentId, branches);
  });

  branchesByParent.forEach((branches) => {
    branches.sort((left, right) => {
      const leftOrdinal = left.option.branch_ordinal ?? left.optionIndex + 1;
      const rightOrdinal = right.option.branch_ordinal ?? right.optionIndex + 1;
      return leftOrdinal - rightOrdinal;
    });
  });

  const pendingPaths: PathProgress[] = (branching.paths ?? []).map((path) => ({
    pathId: path.path_id,
    leafNodeId: safeLabel(path.leaf_node_id),
    nodeIds: distinct(path.node_ids ?? []),
    status: path.status,
    selectionTrail: (path.selection_trail ?? []).map((selection) => ({
      branchPointId: safeLabel(selection.branch_point_id),
      nodeId: safeLabel(selection.node_id),
      parentNodeId: safeLabel(selection.parent_node_id),
      branchOrdinal: selection.branch_ordinal,
    })),
  }));
  const completedPaths: PathProgress[] = branching.outputs.ready
    ? branching.outputs.paths.map((path) => ({
        pathId: path.path_id,
        leafNodeId: safeLabel(path.leaf_node_id),
        nodeIds: [],
        status: "COMPLETED",
        selectionTrail: [],
      }))
    : [];
  const pathsById = new Map<string, PathProgress>();
  [...completedPaths, ...pendingPaths].forEach((path) => pathsById.set(path.pathId, path));
  const allPaths = [...pathsById.values()];

  const pathVisitsNode = (path: PathProgress, nodeId: string) =>
    path.leafNodeId === nodeId ||
    path.nodeIds.includes(nodeId) ||
    path.selectionTrail.some(
      (selection) => selection.nodeId === nodeId || selection.parentNodeId === nodeId,
    );

  const leafMemo = new Map<string, string[]>();
  const collectLeafPathIds = (nodeId: string, ancestry = new Set<string>()): string[] => {
    const memoized = leafMemo.get(nodeId);
    if (memoized) return memoized;
    if (ancestry.has(nodeId)) return [];

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(nodeId);
    const pathIds = new Set(incomingLeafIds.get(nodeId) ?? []);

    allPaths.forEach((path) => {
      if (nodeId === rootNodeId || pathVisitsNode(path, nodeId)) pathIds.add(path.pathId);
    });
    (branchesByParent.get(nodeId) ?? []).forEach((branch) => {
      (branch.option.leaf_path_ids ?? []).forEach((pathId) => {
        if (safeLabel(pathId)) pathIds.add(pathId);
      });
      collectLeafPathIds(branch.nodeId, nextAncestry).forEach((pathId) => pathIds.add(pathId));
    });

    const result = [...pathIds];
    leafMemo.set(nodeId, result);
    return result;
  };

  const structuralLeafMemo = new Map<string, Set<string>>();
  const collectStructuralLeaves = (nodeId: string, ancestry = new Set<string>()): Set<string> => {
    const memoized = structuralLeafMemo.get(nodeId);
    if (memoized) return memoized;
    if (ancestry.has(nodeId)) return new Set();

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(nodeId);
    const children = branchesByParent.get(nodeId) ?? [];
    const leaves = new Set<string>();
    if (children.length === 0) {
      leaves.add(nodeId);
    } else {
      children.forEach((branch) => {
        collectStructuralLeaves(branch.nodeId, nextAncestry).forEach((leaf) => leaves.add(leaf));
      });
    }
    structuralLeafMemo.set(nodeId, leaves);
    return leaves;
  };

  const normalizedActivePathId = safeLabel(activePathId);
  const activePendingPath = normalizedActivePathId
    ? pendingPaths.find((path) => path.pathId === normalizedActivePathId)
    : undefined;
  const fallbackNodes = new Set<string>();
  const fallbackEdges = new Set<string>();

  if (activePendingPath) {
    activePendingPath.nodeIds.forEach((nodeId, index, nodeIds) => {
      fallbackNodes.add(nodeId);
      if (index > 0) fallbackEdges.add(edgeKey(nodeIds[index - 1], nodeId));
    });
    if (activePendingPath.leafNodeId) fallbackNodes.add(activePendingPath.leafNodeId);
    activePendingPath.selectionTrail.forEach((selection) => {
      if (selection.parentNodeId) fallbackNodes.add(selection.parentNodeId);
      if (selection.nodeId) fallbackNodes.add(selection.nodeId);
      if (selection.parentNodeId && selection.nodeId) {
        fallbackEdges.add(edgeKey(selection.parentNodeId, selection.nodeId));
      }
    });
  }

  const activeBranches = new Set<string>();
  branchesByParent.forEach((branches) => {
    branches.forEach((branch) => {
      const directlyContainsPath = Boolean(
        normalizedActivePathId && branch.option.leaf_path_ids?.includes(normalizedActivePathId),
      );
      const matchesFallbackTrail = Boolean(
        activePendingPath?.selectionTrail.some((selection) => {
          const samePoint =
            selection.branchPointId &&
            selection.branchPointId === safeLabel(branch.point.branch_point_id);
          const sameNode = selection.nodeId && selection.nodeId === branch.nodeId;
          const sameOrdinal =
            selection.branchOrdinal !== undefined &&
            selection.branchOrdinal === (branch.option.branch_ordinal ?? branch.optionIndex + 1);
          return (samePoint && (sameNode || sameOrdinal)) ||
            (selection.parentNodeId === branch.parentId && sameNode);
        }),
      );
      const matchesFallbackNodes =
        fallbackNodes.has(branch.nodeId) && fallbackNodes.has(branch.parentId);
      if (
        directlyContainsPath ||
        matchesFallbackTrail ||
        matchesFallbackNodes ||
        fallbackEdges.has(edgeKey(branch.parentId, branch.nodeId))
      ) {
        activeBranches.add(branch.key);
      }
    });
  });

  const activePathIsKnown = Boolean(
    normalizedActivePathId &&
      (pathsById.has(normalizedActivePathId) || activeBranches.size > 0),
  );
  const activeNodes = new Set<string>();
  if (activePathIsKnown) activeNodes.add(rootNodeId);
  branchesByParent.forEach((branches) => {
    branches.forEach((branch) => {
      if (activeBranches.has(branch.key)) {
        activeNodes.add(branch.parentId);
        activeNodes.add(branch.nodeId);
      }
    });
  });

  const renderNode = (
    nodeId: string,
    depth: number,
    incomingBranch?: Branch,
    ancestry = new Set<string>(),
  ): ReactNode => {
    const isCycle = ancestry.has(nodeId);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(nodeId);
    const children = isCycle ? [] : branchesByParent.get(nodeId) ?? [];
    const leafPathIds = collectLeafPathIds(nodeId);
    const structuralLeafCount = collectStructuralLeaves(nodeId).size;
    const reportedRootCount = nodeId === rootNodeId ? branching.summary?.total_paths ?? 0 : 0;
    const leafCount = Math.max(leafPathIds.length, structuralLeafCount, reportedRootCount);
    const relevantPaths = leafPathIds
      .map((pathId) => pathsById.get(pathId))
      .filter((path): path is PathProgress => Boolean(path));
    const nodeStatus = statusForPaths(relevantPaths, branching.status);
    const isActive = activeNodes.has(nodeId);
    const isRoot = !incomingBranch;
    const isLeaf = children.length === 0;
    const label = isRoot
      ? "Opening sequence"
      : safeLabel(incomingBranch.option.path_name) ??
        safeLabel(incomingBranch.option["branching_hint"]) ??
        `Branch ${incomingBranch.option.branch_ordinal ?? incomingBranch.optionIndex + 1}`;
    const description = isRoot
      ? "Every generated route begins here."
      : safeLabel(incomingBranch.option.path_description) ??
        safeLabel(incomingBranch.option["description"]);
    const kicker = isRoot
      ? "Story root"
      : isLeaf
        ? "Ending"
        : `Level ${depth}`;

    return (
      <div
        className={classNames(
          styles.branchNode,
          isRoot && styles.branchNodeRoot,
          isLeaf && styles.branchNodeLeaf,
          isActive && styles.active,
        )}
        key={incomingBranch?.key ?? nodeId}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={children.length > 0 ? true : undefined}
        aria-selected={isActive}
        aria-current={isActive ? "step" : undefined}
      >
        <div
          className={classNames(styles.branchNodeCard, isActive && styles.active)}
          data-node-id={nodeId}
        >
          <span className={styles.branchNodeKicker}>{kicker}</span>
          <strong className={styles.branchNodeTitle}>{label}</strong>
          {description && <p className={styles.branchNodeDescription}>{description}</p>}
          {isCycle && (
            <p className={styles.branchNodeDescription}>This branch links to an earlier node.</p>
          )}
          <span className={styles.branchNodeMeta}>
            <span className={styles.branchNodeLeafCount}>{pathCountLabel(leafCount)}</span>
            <span
              className={classNames(
                styles.branchNodeStatus,
                styles[`status${nodeStatus.tone[0].toUpperCase()}${nodeStatus.tone.slice(1)}`],
              )}
            >
              <span className={styles.branchStatusDot} aria-hidden="true" />
              {nodeStatus.label}
            </span>
          </span>
        </div>

        {children.length > 0 && (
          <div className={styles.branchChildren} role="group">
            {children.map((branch) => {
              const edgeIsActive = activeBranches.has(branch.key);
              return (
                <div
                  className={classNames(styles.branchChild, edgeIsActive && styles.active)}
                  key={branch.key}
                >
                  <span
                    className={classNames(styles.branchEdge, edgeIsActive && styles.active)}
                    aria-hidden="true"
                  />
                  {renderNode(branch.nodeId, depth + 1, branch, nextAncestry)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={styles.branchTreeScroller}
      tabIndex={0}
      aria-label="Interactive story branch map. Scroll horizontally to explore every path."
    >
      <div
        className={styles.branchTree}
        role="tree"
        aria-label="Interactive story branches"
        aria-orientation="horizontal"
      >
        {renderNode(rootNodeId, 0)}
      </div>
    </div>
  );
}

export type { BranchTreeProps };

export default BranchTree;
