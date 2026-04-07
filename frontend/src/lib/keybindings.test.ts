import { describe, it, expect } from "vitest";
import {
  type Action,
  DEFAULT_KEYMAP,
  parseBinding,
  matchKeybinding,
} from "./keybindings";

describe("DEFAULT_KEYMAP", () => {
  it("has bindings for core actions", () => {
    const actions = Object.keys(DEFAULT_KEYMAP) as Action[];
    expect(actions).toContain("session.new");
    expect(actions).toContain("session.kill");
    expect(actions).toContain("session.next");
    expect(actions).toContain("session.prev");
  });
});

describe("parseBinding", () => {
  it("parses simple key", () => {
    expect(parseBinding("Escape")).toEqual({
      key: "Escape",
      ctrl: false,
      shift: false,
      alt: false,
    });
  });

  it("parses Ctrl+Shift combo", () => {
    expect(parseBinding("Ctrl+Shift+N")).toEqual({
      key: "n",
      ctrl: true,
      shift: true,
      alt: false,
    });
  });

  it("parses Alt combo", () => {
    expect(parseBinding("Alt+1")).toEqual({
      key: "1",
      ctrl: false,
      shift: false,
      alt: true,
    });
  });

  it("parses Ctrl+Shift+bracket", () => {
    expect(parseBinding("Ctrl+Shift+]")).toEqual({
      key: "]",
      ctrl: true,
      shift: true,
      alt: false,
    });
  });
});

describe("matchKeybinding", () => {
  it("matches a Ctrl+Shift+N event to session.new", () => {
    const event = new KeyboardEvent("keydown", {
      key: "N",
      ctrlKey: true,
      shiftKey: true,
    });
    const keymap = { ...DEFAULT_KEYMAP };
    expect(matchKeybinding(event, keymap)).toBe("session.new");
  });

  it("returns null for unbound keys", () => {
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
    });
    expect(matchKeybinding(event, DEFAULT_KEYMAP)).toBeNull();
  });

  it("respects user overrides", () => {
    const event = new KeyboardEvent("keydown", {
      key: "T",
      ctrlKey: true,
      shiftKey: true,
    });
    const overrides = { "session.new": "Ctrl+Shift+T" };
    const keymap = { ...DEFAULT_KEYMAP, ...overrides };
    expect(matchKeybinding(event, keymap)).toBe("session.new");
  });

  it("does not match when modifier is missing", () => {
    const event = new KeyboardEvent("keydown", {
      key: "N",
      ctrlKey: false,
      shiftKey: true,
    });
    expect(matchKeybinding(event, DEFAULT_KEYMAP)).toBeNull();
  });
});
