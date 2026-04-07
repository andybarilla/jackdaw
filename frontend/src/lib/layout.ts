export type PaneContent =
  | { type: "session"; sessionId: string }
  | { type: "terminal"; id: string; workDir: string }
  | null;

export type LayoutNode =
  | { type: "leaf"; content: PaneContent }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };

export type Path = (0 | 1)[];

export function emptyLeaf(): LayoutNode {
  return { type: "leaf", content: null };
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

export function getLeafContent(node: LayoutNode, path: Path): PaneContent {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    return node.content;
  }
  if (node.type !== "split") {
    throw new Error("Path leads through a non-split node");
  }
  const [head, ...tail] = path;
  return getLeafContent(node.children[head], tail as Path);
}

export function setLeafContent(
  node: LayoutNode,
  path: Path,
  content: PaneContent
): LayoutNode {
  if (path.length === 0) {
    if (node.type !== "leaf") {
      throw new Error("Path does not lead to a leaf");
    }
    return { type: "leaf", content };
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

export function findLeafBySessionId(node: LayoutNode, sessionId: string): Path | null {
  if (node.type === "leaf") {
    if (node.content?.type === "session" && node.content.sessionId === sessionId) {
      return [];
    }
    return null;
  }
  const leftResult = findLeafBySessionId(node.children[0], sessionId);
  if (leftResult !== null) {
    return [0, ...leftResult];
  }
  const rightResult = findLeafBySessionId(node.children[1], sessionId);
  if (rightResult !== null) {
    return [1, ...rightResult];
  }
  return null;
}

export function findLeafByTerminalId(node: LayoutNode, terminalId: string): Path | null {
  if (node.type === "leaf") {
    if (node.content?.type === "terminal" && node.content.id === terminalId) {
      return [];
    }
    return null;
  }
  const leftResult = findLeafByTerminalId(node.children[0], terminalId);
  if (leftResult !== null) {
    return [0, ...leftResult];
  }
  const rightResult = findLeafByTerminalId(node.children[1], terminalId);
  if (rightResult !== null) {
    return [1, ...rightResult];
  }
  return null;
}

export function collectSessionIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.content?.type === "session" ? [node.content.sessionId] : [];
  }
  return [
    ...collectSessionIds(node.children[0]),
    ...collectSessionIds(node.children[1]),
  ];
}

export function collectTerminalIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.content?.type === "terminal" ? [node.content.id] : [];
  }
  return [
    ...collectTerminalIds(node.children[0]),
    ...collectTerminalIds(node.children[1]),
  ];
}
