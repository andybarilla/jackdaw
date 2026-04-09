export type PaneContent =
  | { type: "session"; sessionId: string }
  | { type: "terminal"; id: string; workDir: string }
  | { type: "diff"; sessionId: string }
  | { type: "dashboard" };

export type LayoutNode =
  | { type: "leaf"; contents: PaneContent[]; activeIndex: number }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };

export type Path = (0 | 1)[];

export type FindResult = { path: Path; tabIndex: number };

export function emptyLeaf(): LayoutNode {
  return { type: "leaf", contents: [], activeIndex: 0 };
}

export function splitLeaf(
  node: LayoutNode,
  path: Path,
  direction: "horizontal" | "vertical"
): LayoutNode {
  if (path.length === 0) {
    return {
      type: "split",
      direction,
      ratio: 0.5,
      children: [{ ...node } as LayoutNode, emptyLeaf()],
    };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [
    node.children[0],
    node.children[1],
  ];
  newChildren[head] = splitLeaf(newChildren[head], tail as Path, direction);
  return { ...node, children: newChildren };
}

export function closeLeaf(node: LayoutNode, path: Path): LayoutNode {
  if (path.length === 0) {
    return emptyLeaf();
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  if (path.length === 1) {
    const idx = path[0];
    return node.children[idx === 0 ? 1 : 0];
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [
    node.children[0],
    node.children[1],
  ];
  newChildren[head] = closeLeaf(newChildren[head], tail as Path);
  return { ...node, children: newChildren };
}

export function updateRatio(node: LayoutNode, path: Path, ratio: number): LayoutNode {
  const clamped = Math.min(0.9, Math.max(0.1, ratio));
  if (path.length === 0) {
    if (node.type !== "split") {
      throw new Error("updateRatio called on a leaf node");
    }
    return { ...node, ratio: clamped };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [
    node.children[0],
    node.children[1],
  ];
  newChildren[head] = updateRatio(newChildren[head], tail as Path, ratio);
  return { ...node, children: newChildren };
}

/** Returns the active tab's content, or null if the leaf is empty. */
export function getLeafContent(node: LayoutNode, path: Path): PaneContent | null {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    return node.contents[node.activeIndex] ?? null;
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  return getLeafContent(node.children[head], tail as Path);
}

/** Returns the full leaf node at the given path. */
export function getLeaf(node: LayoutNode, path: Path): Extract<LayoutNode, { type: "leaf" }> {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    return node;
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  return getLeaf(node.children[head], tail as Path);
}

/** Replace the active tab's content, or set single content on empty leaf. Pass null to clear. */
export function setLeafContent(
  node: LayoutNode,
  path: Path,
  content: PaneContent | null
): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    if (content === null) {
      return { type: "leaf", contents: [], activeIndex: 0 };
    }
    if (node.contents.length === 0) {
      return { type: "leaf", contents: [content], activeIndex: 0 };
    }
    const newContents = [...node.contents];
    newContents[node.activeIndex] = content;
    return { type: "leaf", contents: newContents, activeIndex: node.activeIndex };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [
    node.children[0],
    node.children[1],
  ];
  newChildren[head] = setLeafContent(newChildren[head], tail as Path, content);
  return { ...node, children: newChildren };
}

export function findLeafBySessionId(node: LayoutNode, sessionId: string): FindResult | null {
  if (node.type === "leaf") {
    for (let i = 0; i < node.contents.length; i++) {
      const c = node.contents[i];
      if (c.type === "session" && c.sessionId === sessionId) {
        return { path: [], tabIndex: i };
      }
    }
    return null;
  }
  const leftResult = findLeafBySessionId(node.children[0], sessionId);
  if (leftResult !== null) {
    return { path: [0, ...leftResult.path] as Path, tabIndex: leftResult.tabIndex };
  }
  const rightResult = findLeafBySessionId(node.children[1], sessionId);
  if (rightResult !== null) {
    return { path: [1, ...rightResult.path] as Path, tabIndex: rightResult.tabIndex };
  }
  return null;
}

export function findLeafByTerminalId(node: LayoutNode, terminalId: string): FindResult | null {
  if (node.type === "leaf") {
    for (let i = 0; i < node.contents.length; i++) {
      const c = node.contents[i];
      if (c.type === "terminal" && c.id === terminalId) {
        return { path: [], tabIndex: i };
      }
    }
    return null;
  }
  const leftResult = findLeafByTerminalId(node.children[0], terminalId);
  if (leftResult !== null) {
    return { path: [0, ...leftResult.path] as Path, tabIndex: leftResult.tabIndex };
  }
  const rightResult = findLeafByTerminalId(node.children[1], terminalId);
  if (rightResult !== null) {
    return { path: [1, ...rightResult.path] as Path, tabIndex: rightResult.tabIndex };
  }
  return null;
}

export function findLeafByDiffSessionId(node: LayoutNode, sessionId: string): FindResult | null {
  if (node.type === "leaf") {
    for (let i = 0; i < node.contents.length; i++) {
      const c = node.contents[i];
      if (c.type === "diff" && c.sessionId === sessionId) {
        return { path: [], tabIndex: i };
      }
    }
    return null;
  }
  const leftResult = findLeafByDiffSessionId(node.children[0], sessionId);
  if (leftResult !== null) {
    return { path: [0, ...leftResult.path] as Path, tabIndex: leftResult.tabIndex };
  }
  const rightResult = findLeafByDiffSessionId(node.children[1], sessionId);
  if (rightResult !== null) {
    return { path: [1, ...rightResult.path] as Path, tabIndex: rightResult.tabIndex };
  }
  return null;
}

export function findLeafByDashboard(node: LayoutNode): FindResult | null {
  if (node.type === "leaf") {
    for (let i = 0; i < node.contents.length; i++) {
      if (node.contents[i].type === "dashboard") {
        return { path: [], tabIndex: i };
      }
    }
    return null;
  }
  const leftResult = findLeafByDashboard(node.children[0]);
  if (leftResult !== null) {
    return { path: [0, ...leftResult.path] as Path, tabIndex: leftResult.tabIndex };
  }
  const rightResult = findLeafByDashboard(node.children[1]);
  if (rightResult !== null) {
    return { path: [1, ...rightResult.path] as Path, tabIndex: rightResult.tabIndex };
  }
  return null;
}

export function collectDashboardPanes(node: LayoutNode): number {
  if (node.type === "leaf") {
    return node.contents.filter((c) => c.type === "dashboard").length;
  }
  return (
    collectDashboardPanes(node.children[0]) +
    collectDashboardPanes(node.children[1])
  );
}

export function collectSessionIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.contents
      .filter((c): c is Extract<PaneContent, { type: "session" }> => c.type === "session")
      .map((c) => c.sessionId);
  }
  return [
    ...collectSessionIds(node.children[0]),
    ...collectSessionIds(node.children[1]),
  ];
}

export function collectTerminalIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.contents
      .filter((c): c is Extract<PaneContent, { type: "terminal" }> => c.type === "terminal")
      .map((c) => c.id);
  }
  return [
    ...collectTerminalIds(node.children[0]),
    ...collectTerminalIds(node.children[1]),
  ];
}

export function collectDiffSessionIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.contents
      .filter((c): c is Extract<PaneContent, { type: "diff" }> => c.type === "diff")
      .map((c) => c.sessionId);
  }
  return [
    ...collectDiffSessionIds(node.children[0]),
    ...collectDiffSessionIds(node.children[1]),
  ];
}

export function collectLeaves(node: LayoutNode): PaneContent[] {
  if (node.type === "leaf") {
    return [...node.contents];
  }
  return [...collectLeaves(node.children[0]), ...collectLeaves(node.children[1])];
}

/** Append a new tab to the leaf at the given path. Sets activeIndex to the new tab. */
export function addTab(node: LayoutNode, path: Path, content: PaneContent): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    const newContents = [...node.contents, content];
    return { type: "leaf", contents: newContents, activeIndex: newContents.length - 1 };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [node.children[0], node.children[1]];
  newChildren[head] = addTab(newChildren[head], tail as Path, content);
  return { ...node, children: newChildren };
}

/** Remove a tab at the given index. Adjusts activeIndex. */
export function removeTab(node: LayoutNode, path: Path, tabIndex: number): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    const newContents = node.contents.filter((_, i) => i !== tabIndex);
    let newActive = node.activeIndex;
    if (tabIndex < newActive) {
      newActive--;
    } else if (tabIndex === newActive) {
      newActive = Math.min(newActive, newContents.length - 1);
    }
    if (newActive < 0) newActive = 0;
    return { type: "leaf", contents: newContents, activeIndex: newActive };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [node.children[0], node.children[1]];
  newChildren[head] = removeTab(newChildren[head], tail as Path, tabIndex);
  return { ...node, children: newChildren };
}

/** Set the active tab index for the leaf at the given path. */
export function setActiveTab(node: LayoutNode, path: Path, tabIndex: number): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    return { ...node, activeIndex: tabIndex };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [node.children[0], node.children[1]];
  newChildren[head] = setActiveTab(newChildren[head], tail as Path, tabIndex);
  return { ...node, children: newChildren };
}

/** Reorder tabs within a leaf: move tab from fromIndex to toIndex. */
export function reorderTab(node: LayoutNode, path: Path, fromIndex: number, toIndex: number): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    const newContents = [...node.contents];
    const [moved] = newContents.splice(fromIndex, 1);
    newContents.splice(toIndex, 0, moved);
    let newActive = node.activeIndex;
    if (node.activeIndex === fromIndex) {
      newActive = toIndex;
    } else if (fromIndex < node.activeIndex && toIndex >= node.activeIndex) {
      newActive--;
    } else if (fromIndex > node.activeIndex && toIndex <= node.activeIndex) {
      newActive++;
    }
    return { type: "leaf", contents: newContents, activeIndex: newActive };
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [node.children[0], node.children[1]];
  newChildren[head] = reorderTab(newChildren[head], tail as Path, fromIndex, toIndex);
  return { ...node, children: newChildren };
}

export function unsplitPane(
  root: LayoutNode,
  focusedPath: Path
): { layout: LayoutNode; detached: PaneContent[] } | null {
  if (focusedPath.length === 0) return null;

  const parentPath = focusedPath.slice(0, -1) as Path;
  const childIdx = focusedPath[focusedPath.length - 1];
  const siblingIdx = childIdx === 0 ? 1 : 0;

  const focusedLeaf = getNodeAtPath(root, focusedPath);
  const siblingPath = [...parentPath, siblingIdx] as Path;
  const siblingNode = getNodeAtPath(root, siblingPath);
  const detached = collectLeaves(siblingNode);

  const layout = replaceNodeAtPath(root, parentPath, focusedLeaf);

  return { layout, detached };
}

function getNodeAtPath(node: LayoutNode, path: Path): LayoutNode {
  if (path.length === 0) return node;
  if (node.type !== "split") throw new Error("Path leads through a non-split node");
  const [head, ...tail] = path;
  return getNodeAtPath(node.children[head], tail as Path);
}

function replaceNodeAtPath(node: LayoutNode, path: Path, replacement: LayoutNode): LayoutNode {
  if (path.length === 0) return replacement;
  if (node.type !== "split") throw new Error("Path leads through a non-split node");
  const [head, ...tail] = path;
  const newChildren: [LayoutNode, LayoutNode] = [node.children[0], node.children[1]];
  newChildren[head] = replaceNodeAtPath(newChildren[head], tail as Path, replacement);
  return { ...node, children: newChildren };
}

/** Migrate old layout format (content: PaneContent | null) to new format (contents[], activeIndex). */
export function migrateLayout(node: unknown): LayoutNode {
  if (typeof node !== "object" || node === null) return emptyLeaf();
  const obj = node as Record<string, unknown>;

  if (obj.type === "leaf") {
    // Already new format
    if (Array.isArray(obj.contents)) {
      return {
        type: "leaf",
        contents: obj.contents as PaneContent[],
        activeIndex: typeof obj.activeIndex === "number" ? obj.activeIndex : 0,
      };
    }
    // Old format: { type: "leaf", content: PaneContent | null }
    if ("content" in obj) {
      const content = obj.content;
      if (content === null || content === undefined) {
        return emptyLeaf();
      }
      return { type: "leaf", contents: [content as PaneContent], activeIndex: 0 };
    }
    return emptyLeaf();
  }

  if (obj.type === "split") {
    const children = obj.children as [unknown, unknown];
    return {
      type: "split",
      direction: obj.direction as "horizontal" | "vertical",
      ratio: obj.ratio as number,
      children: [migrateLayout(children[0]), migrateLayout(children[1])],
    };
  }

  return emptyLeaf();
}
