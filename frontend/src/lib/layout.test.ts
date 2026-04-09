import { describe, it, expect } from "vitest";
import {
  emptyLeaf,
  splitLeaf,
  closeLeaf,
  updateRatio,
  getLeafContent,
  getLeaf,
  setLeafContent,
  findLeafBySessionId,
  findLeafByTerminalId,
  findLeafByDiffSessionId,
  collectSessionIds,
  collectTerminalIds,
  collectDiffSessionIds,
  collectLeaves,
  addTab,
  removeTab,
  setActiveTab,
  reorderTab,
  migrateLayout,
  type LayoutNode,
  type PaneContent,
} from "./layout";

// Helpers
const sessionLeaf = (id: string): LayoutNode => ({
  type: "leaf",
  contents: [{ type: "session", sessionId: id }],
  activeIndex: 0,
});

const terminalLeaf = (id: string, workDir = "/tmp"): LayoutNode => ({
  type: "leaf",
  contents: [{ type: "terminal", id, workDir }],
  activeIndex: 0,
});

const diffLeaf = (id: string): LayoutNode => ({
  type: "leaf",
  contents: [{ type: "diff", sessionId: id }],
  activeIndex: 0,
});

const multiTabLeaf = (...contents: PaneContent[]): LayoutNode => ({
  type: "leaf",
  contents,
  activeIndex: 0,
});

describe("emptyLeaf", () => {
  it("returns a leaf with empty contents", () => {
    expect(emptyLeaf()).toEqual({ type: "leaf", contents: [], activeIndex: 0 });
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
    const root = sessionLeaf("abc");
    const result = splitLeaf(root, [], "horizontal");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.children[0]).toEqual(sessionLeaf("abc"));
      expect(result.children[1]).toEqual(emptyLeaf());
    }
  });

  it("preserves multi-tab leaf when splitting", () => {
    const root = multiTabLeaf(
      { type: "session", sessionId: "s1" },
      { type: "session", sessionId: "s2" },
    );
    const result = splitLeaf(root, [], "vertical");
    if (result.type === "split") {
      const left = result.children[0];
      if (left.type === "leaf") {
        expect(left.contents).toHaveLength(2);
      }
    }
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
    if (result.type === "split") {
      expect(result.ratio).toBe(0.7);
    }
  });

  it("clamps ratio to min 0.1 and max 0.9", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    const low = updateRatio(root, [], 0.05);
    const high = updateRatio(root, [], 0.95);
    if (low.type === "split") expect(low.ratio).toBe(0.1);
    if (high.type === "split") expect(high.ratio).toBe(0.9);
  });
});

describe("getLeafContent", () => {
  it("returns active content of root leaf", () => {
    const root = sessionLeaf("s1");
    expect(getLeafContent(root, [])).toEqual({ type: "session", sessionId: "s1" });
  });

  it("returns null for empty leaf", () => {
    expect(getLeafContent(emptyLeaf(), [])).toBeNull();
  });

  it("returns active tab content from multi-tab leaf", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
      ],
      activeIndex: 1,
    };
    expect(getLeafContent(root, [])).toEqual({ type: "session", sessionId: "s2" });
  });
});

describe("getLeaf", () => {
  it("returns the leaf node", () => {
    const root = sessionLeaf("s1");
    const leaf = getLeaf(root, []);
    expect(leaf.contents).toHaveLength(1);
    expect(leaf.activeIndex).toBe(0);
  });
});

describe("setLeafContent", () => {
  it("sets content on empty leaf", () => {
    const root = emptyLeaf();
    const result = setLeafContent(root, [], { type: "session", sessionId: "s1" });
    if (result.type === "leaf") {
      expect(result.contents).toEqual([{ type: "session", sessionId: "s1" }]);
    }
  });

  it("replaces active tab content", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
      ],
      activeIndex: 1,
    };
    const result = setLeafContent(root, [], { type: "session", sessionId: "s3" });
    if (result.type === "leaf") {
      expect(result.contents[0]).toEqual({ type: "session", sessionId: "s1" });
      expect(result.contents[1]).toEqual({ type: "session", sessionId: "s3" });
    }
  });

  it("clears leaf when set to null", () => {
    const root = sessionLeaf("s1");
    const result = setLeafContent(root, [], null);
    expect(result).toEqual(emptyLeaf());
  });
});

describe("addTab", () => {
  it("adds tab to empty leaf", () => {
    const root = emptyLeaf();
    const result = addTab(root, [], { type: "session", sessionId: "s1" });
    if (result.type === "leaf") {
      expect(result.contents).toHaveLength(1);
      expect(result.activeIndex).toBe(0);
    }
  });

  it("appends tab and sets it active", () => {
    const root = sessionLeaf("s1");
    const result = addTab(root, [], { type: "session", sessionId: "s2" });
    if (result.type === "leaf") {
      expect(result.contents).toHaveLength(2);
      expect(result.activeIndex).toBe(1);
      expect(result.contents[1]).toEqual({ type: "session", sessionId: "s2" });
    }
  });

  it("works at nested path", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), emptyLeaf()],
    };
    const result = addTab(root, [0] as any, { type: "session", sessionId: "s2" });
    if (result.type === "split" && result.children[0].type === "leaf") {
      expect(result.children[0].contents).toHaveLength(2);
      expect(result.children[0].activeIndex).toBe(1);
    }
  });
});

describe("removeTab", () => {
  it("removes sole tab, leaving empty leaf", () => {
    const root = sessionLeaf("s1");
    const result = removeTab(root, [], 0);
    if (result.type === "leaf") {
      expect(result.contents).toHaveLength(0);
      expect(result.activeIndex).toBe(0);
    }
  });

  it("removes tab before active, adjusts activeIndex", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
        { type: "session", sessionId: "s3" },
      ],
      activeIndex: 2,
    };
    const result = removeTab(root, [], 0);
    if (result.type === "leaf") {
      expect(result.contents).toHaveLength(2);
      expect(result.activeIndex).toBe(1); // was 2, shifted down
    }
  });

  it("removes active tab, clamps to last", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
      ],
      activeIndex: 1,
    };
    const result = removeTab(root, [], 1);
    if (result.type === "leaf") {
      expect(result.contents).toHaveLength(1);
      expect(result.activeIndex).toBe(0);
    }
  });

  it("removes tab after active, no change to activeIndex", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
        { type: "session", sessionId: "s3" },
      ],
      activeIndex: 0,
    };
    const result = removeTab(root, [], 2);
    if (result.type === "leaf") {
      expect(result.contents).toHaveLength(2);
      expect(result.activeIndex).toBe(0);
    }
  });
});

describe("setActiveTab", () => {
  it("sets activeIndex", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
      ],
      activeIndex: 0,
    };
    const result = setActiveTab(root, [], 1);
    if (result.type === "leaf") {
      expect(result.activeIndex).toBe(1);
    }
  });
});

describe("reorderTab", () => {
  it("moves tab forward", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
        { type: "session", sessionId: "s3" },
      ],
      activeIndex: 0,
    };
    const result = reorderTab(root, [], 0, 2);
    if (result.type === "leaf") {
      expect(result.contents.map((c) => c.type === "session" ? c.sessionId : "")).toEqual(["s2", "s3", "s1"]);
      expect(result.activeIndex).toBe(2); // active tab moved with it
    }
  });

  it("moves tab backward", () => {
    const root: LayoutNode = {
      type: "leaf",
      contents: [
        { type: "session", sessionId: "s1" },
        { type: "session", sessionId: "s2" },
        { type: "session", sessionId: "s3" },
      ],
      activeIndex: 2,
    };
    const result = reorderTab(root, [], 2, 0);
    if (result.type === "leaf") {
      expect(result.contents.map((c) => c.type === "session" ? c.sessionId : "")).toEqual(["s3", "s1", "s2"]);
      expect(result.activeIndex).toBe(0);
    }
  });
});

describe("findLeafBySessionId", () => {
  it("finds session in single-tab leaf", () => {
    const root = sessionLeaf("s1");
    expect(findLeafBySessionId(root, "s1")).toEqual({ path: [], tabIndex: 0 });
  });

  it("returns null when not found", () => {
    expect(findLeafBySessionId(emptyLeaf(), "s1")).toBeNull();
  });

  it("finds session in multi-tab leaf", () => {
    const root = multiTabLeaf(
      { type: "session", sessionId: "s1" },
      { type: "terminal", id: "t1", workDir: "/tmp" },
      { type: "session", sessionId: "s2" },
    );
    expect(findLeafBySessionId(root, "s2")).toEqual({ path: [], tabIndex: 2 });
  });

  it("finds session in nested tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(findLeafBySessionId(root, "s2")).toEqual({ path: [1], tabIndex: 0 });
  });
});

describe("findLeafByTerminalId", () => {
  it("finds terminal in multi-tab leaf", () => {
    const root = multiTabLeaf(
      { type: "session", sessionId: "s1" },
      { type: "terminal", id: "t1", workDir: "/tmp" },
    );
    expect(findLeafByTerminalId(root, "t1")).toEqual({ path: [], tabIndex: 1 });
  });

  it("returns null for non-matching", () => {
    expect(findLeafByTerminalId(sessionLeaf("s1"), "t1")).toBeNull();
  });
});

describe("findLeafByDiffSessionId", () => {
  it("finds diff in leaf", () => {
    const root = diffLeaf("s1");
    expect(findLeafByDiffSessionId(root, "s1")).toEqual({ path: [], tabIndex: 0 });
  });

  it("finds diff in multi-tab leaf", () => {
    const root = multiTabLeaf(
      { type: "session", sessionId: "s1" },
      { type: "diff", sessionId: "s1" },
    );
    expect(findLeafByDiffSessionId(root, "s1")).toEqual({ path: [], tabIndex: 1 });
  });
});

describe("collectSessionIds", () => {
  it("returns empty array for empty leaf", () => {
    expect(collectSessionIds(emptyLeaf())).toEqual([]);
  });

  it("collects from single leaf", () => {
    expect(collectSessionIds(sessionLeaf("s1"))).toEqual(["s1"]);
  });

  it("collects from multi-tab leaf", () => {
    const root = multiTabLeaf(
      { type: "session", sessionId: "s1" },
      { type: "terminal", id: "t1", workDir: "/tmp" },
      { type: "session", sessionId: "s2" },
    );
    expect(collectSessionIds(root).sort()).toEqual(["s1", "s2"]);
  });

  it("collects from tree", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), sessionLeaf("s2")],
    };
    expect(collectSessionIds(root).sort()).toEqual(["s1", "s2"]);
  });
});

describe("collectTerminalIds", () => {
  it("collects from multi-tab leaf", () => {
    const root = multiTabLeaf(
      { type: "session", sessionId: "s1" },
      { type: "terminal", id: "t1", workDir: "/tmp" },
      { type: "terminal", id: "t2", workDir: "/tmp" },
    );
    expect(collectTerminalIds(root).sort()).toEqual(["t1", "t2"]);
  });
});

describe("collectDiffSessionIds", () => {
  it("collects from multi-tab leaf", () => {
    const root = multiTabLeaf(
      { type: "diff", sessionId: "s1" },
      { type: "session", sessionId: "s2" },
    );
    expect(collectDiffSessionIds(root)).toEqual(["s1"]);
  });
});

describe("collectLeaves", () => {
  it("returns all contents from all tabs", () => {
    const root: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        multiTabLeaf(
          { type: "session", sessionId: "s1" },
          { type: "session", sessionId: "s2" },
        ),
        sessionLeaf("s3"),
      ],
    };
    expect(collectLeaves(root)).toHaveLength(3);
  });

  it("returns empty for empty leaf", () => {
    expect(collectLeaves(emptyLeaf())).toEqual([]);
  });
});

describe("migrateLayout", () => {
  it("converts old null content to empty leaf", () => {
    const old = { type: "leaf", content: null };
    expect(migrateLayout(old)).toEqual(emptyLeaf());
  });

  it("converts old content to single-tab leaf", () => {
    const old = { type: "leaf", content: { type: "session", sessionId: "s1" } };
    expect(migrateLayout(old)).toEqual(sessionLeaf("s1"));
  });

  it("passes through new format unchanged", () => {
    const node = sessionLeaf("s1");
    expect(migrateLayout(node)).toEqual(node);
  });

  it("migrates nested split tree", () => {
    const old = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", content: { type: "session", sessionId: "s1" } },
        { type: "leaf", content: null },
      ],
    };
    const result = migrateLayout(old);
    expect(result).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [sessionLeaf("s1"), emptyLeaf()],
    });
  });

  it("handles garbage input gracefully", () => {
    expect(migrateLayout(null)).toEqual(emptyLeaf());
    expect(migrateLayout(42)).toEqual(emptyLeaf());
    expect(migrateLayout("bad")).toEqual(emptyLeaf());
  });
});
