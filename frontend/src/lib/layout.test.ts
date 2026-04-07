import { describe, it, expect } from "vitest";
import {
  emptyLeaf,
  splitLeaf,
  closeLeaf,
  updateRatio,
  getLeafContent,
  setLeafContent,
  findLeafBySessionId,
  findLeafByTerminalId,
  collectSessionIds,
  collectTerminalIds,
  type LayoutNode,
  type PaneContent,
} from "./layout";

// Helpers
const sessionLeaf = (id: string): LayoutNode => ({
  type: "leaf",
  content: { type: "session", sessionId: id },
});

const terminalLeaf = (id: string, workDir = "/tmp"): LayoutNode => ({
  type: "leaf",
  content: { type: "terminal", id, workDir },
});

describe("emptyLeaf", () => {
  it("returns a leaf with null content", () => {
    expect(emptyLeaf()).toEqual({ type: "leaf", content: null });
  });

  it("returns a new object each call", () => {
    expect(emptyLeaf()).not.toBe(emptyLeaf());
  });
});

describe("splitLeaf", () => {
  it("splits root leaf horizontally", () => {
    const root = sessionLeaf("s1");
    const result = splitLeaf(root, [], "horizontal");
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), emptyLeaf()],
    });
  });

  it("splits root leaf vertically", () => {
    const root = sessionLeaf("s1");
    const result = splitLeaf(root, [], "vertical");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.direction).toBe("vertical");
    }
  });

  it("original content stays in children[0]", () => {
    const content: PaneContent = { type: "session", sessionId: "abc" };
    const root: LayoutNode = { type: "leaf", content };
    const result = splitLeaf(root, [], "horizontal");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[0]).toEqual({ type: "leaf", content });
      expect(result.children[1]).toEqual(emptyLeaf());
    }
  });

  it("splits nested leaf at path [0]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = splitLeaf(root, [0], "vertical");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[0].type).toBe("split");
      if (result.children[0].type === "split") {
        expect(result.children[0].direction).toBe("vertical");
        expect(result.children[0].children[0]).toEqual(sessionLeaf("s1"));
        expect(result.children[0].children[1]).toEqual(emptyLeaf());
      }
      expect(result.children[1]).toEqual(sessionLeaf("s2"));
    }
  });

  it("splits nested leaf at path [1]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = splitLeaf(root, [1], "horizontal");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[0]).toEqual(sessionLeaf("s1"));
      expect(result.children[1].type).toBe("split");
    }
  });

  it("does not mutate original tree", () => {
    const root = sessionLeaf("s1");
    const frozen = Object.freeze({ ...root });
    splitLeaf(frozen as LayoutNode, [], "horizontal");
    expect(frozen).toEqual(sessionLeaf("s1"));
  });
});

describe("closeLeaf", () => {
  it("returns empty leaf when closing root leaf", () => {
    const root = sessionLeaf("s1");
    const result = closeLeaf(root, []);
    expect(result).toEqual(emptyLeaf());
  });

  it("replaces parent split with sibling when closing children[0]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = closeLeaf(root, [0]);
    expect(result).toEqual(sessionLeaf("s2"));
  });

  it("replaces parent split with sibling when closing children[1]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = closeLeaf(root, [1]);
    expect(result).toEqual(sessionLeaf("s1"));
  });

  it("closes deeply nested leaf", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [sessionLeaf("s1"), sessionLeaf("s2")],
        },
        sessionLeaf("s3"),
      ],
    };
    const result = closeLeaf(root, [0, 0]);
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[0]).toEqual(sessionLeaf("s2"));
      expect(result.children[1]).toEqual(sessionLeaf("s3"));
    }
  });

  it("does not mutate original tree", () => {
    const child1 = sessionLeaf("s1");
    const child2 = sessionLeaf("s2");
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [child1, child2],
    };
    closeLeaf(root, [0]);
    expect(root.type).toBe("split");
    if (root.type === "split") {
      expect(root.children[0]).toEqual(child1);
    }
  });
});

describe("updateRatio", () => {
  it("updates ratio at root split", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = updateRatio(root, [], 0.7);
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.ratio).toBe(0.7);
    }
  });

  it("clamps ratio to minimum 0.1", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = updateRatio(root, [], 0.05);
    if (result.type === "split") {
      expect(result.ratio).toBe(0.1);
    }
  });

  it("clamps ratio to maximum 0.9", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const result = updateRatio(root, [], 0.95);
    if (result.type === "split") {
      expect(result.ratio).toBe(0.9);
    }
  });

  it("updates nested split at path [0]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [sessionLeaf("s1"), sessionLeaf("s2")],
        },
        sessionLeaf("s3"),
      ],
    };
    const result = updateRatio(root, [0], 0.3);
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.ratio).toBe(0.5); // root unchanged
      const left = result.children[0];
      if (left.type === "split") {
        expect(left.ratio).toBe(0.3);
      }
    }
  });

  it("does not mutate original tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    updateRatio(root, [], 0.7);
    if (root.type === "split") {
      expect(root.ratio).toBe(0.5);
    }
  });
});

describe("getLeafContent", () => {
  it("returns content of root leaf", () => {
    const content: PaneContent = { type: "session", sessionId: "s1" };
    const root: LayoutNode = { type: "leaf", content };
    expect(getLeafContent(root, [])).toEqual(content);
  });

  it("returns content at path [0]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(getLeafContent(root, [0])).toEqual({
      type: "session",
      sessionId: "s1",
    });
  });

  it("returns content at path [1]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(getLeafContent(root, [1])).toEqual({
      type: "session",
      sessionId: "s2",
    });
  });

  it("returns null for empty leaf", () => {
    expect(getLeafContent(emptyLeaf(), [])).toBeNull();
  });
});

describe("setLeafContent", () => {
  it("sets content at root leaf", () => {
    const root = emptyLeaf();
    const content: PaneContent = { type: "session", sessionId: "s1" };
    const result = setLeafContent(root, [], content);
    expect(result).toEqual({ type: "leaf", content });
  });

  it("sets content at path [0]", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [emptyLeaf(), sessionLeaf("s2")],
    };
    const content: PaneContent = { type: "session", sessionId: "s1" };
    const result = setLeafContent(root, [0], content);
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[0]).toEqual({ type: "leaf", content });
      expect(result.children[1]).toEqual(sessionLeaf("s2"));
    }
  });

  it("does not mutate original tree", () => {
    const root = emptyLeaf();
    setLeafContent(root, [], { type: "session", sessionId: "s1" });
    expect(root.content).toBeNull();
  });
});

describe("findLeafBySessionId", () => {
  it("returns [] for root leaf with matching session", () => {
    const root = sessionLeaf("s1");
    expect(findLeafBySessionId(root, "s1")).toEqual([]);
  });

  it("returns null for root leaf with non-matching session", () => {
    const root = sessionLeaf("s1");
    expect(findLeafBySessionId(root, "s2")).toBeNull();
  });

  it("returns null for empty leaf", () => {
    expect(findLeafBySessionId(emptyLeaf(), "s1")).toBeNull();
  });

  it("finds session in left child", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(findLeafBySessionId(root, "s1")).toEqual([0]);
  });

  it("finds session in right child", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(findLeafBySessionId(root, "s2")).toEqual([1]);
  });

  it("finds session deep in tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [sessionLeaf("s1"), sessionLeaf("s2")],
        },
        sessionLeaf("s3"),
      ],
    };
    expect(findLeafBySessionId(root, "s2")).toEqual([0, 1]);
  });
});

describe("findLeafByTerminalId", () => {
  it("returns [] for root leaf with matching terminal", () => {
    const root = terminalLeaf("t1");
    expect(findLeafByTerminalId(root, "t1")).toEqual([]);
  });

  it("returns null for non-matching terminal", () => {
    const root = terminalLeaf("t1");
    expect(findLeafByTerminalId(root, "t2")).toBeNull();
  });

  it("finds terminal in tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [terminalLeaf("t1"), terminalLeaf("t2")],
    };
    expect(findLeafByTerminalId(root, "t2")).toEqual([1]);
  });

  it("does not match session nodes", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("t1"), terminalLeaf("t2")],
    };
    expect(findLeafByTerminalId(root, "t1")).toBeNull();
  });
});

describe("collectSessionIds", () => {
  it("returns empty array for empty leaf", () => {
    expect(collectSessionIds(emptyLeaf())).toEqual([]);
  });

  it("returns session id from single leaf", () => {
    expect(collectSessionIds(sessionLeaf("s1"))).toEqual(["s1"]);
  });

  it("does not include terminal ids", () => {
    expect(collectSessionIds(terminalLeaf("t1"))).toEqual([]);
  });

  it("collects all session ids from tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(collectSessionIds(root).sort()).toEqual(["s1", "s2"]);
  });

  it("collects ids from nested tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [sessionLeaf("s1"), terminalLeaf("t1")],
        },
        sessionLeaf("s3"),
      ],
    };
    expect(collectSessionIds(root).sort()).toEqual(["s1", "s3"]);
  });
});

describe("collectTerminalIds", () => {
  it("returns empty array for empty leaf", () => {
    expect(collectTerminalIds(emptyLeaf())).toEqual([]);
  });

  it("returns terminal id from single leaf", () => {
    expect(collectTerminalIds(terminalLeaf("t1"))).toEqual(["t1"]);
  });

  it("does not include session ids", () => {
    expect(collectTerminalIds(sessionLeaf("s1"))).toEqual([]);
  });

  it("collects all terminal ids from tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [terminalLeaf("t1"), terminalLeaf("t2")],
    };
    expect(collectTerminalIds(root).sort()).toEqual(["t1", "t2"]);
  });
});
