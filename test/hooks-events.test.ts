import { describe, it, expect } from "vitest";
import {
  EVENT_CATALOG,
  matchesEventPattern,
  resolvePattern,
  getEvent,
  allEventNames,
  emittedEventNames,
} from "../src/hooks/events.js";

describe("wildcard event matching", () => {
  it("matches an exact name", () => {
    expect(matchesEventPattern("implement.post", "implement.post")).toBe(true);
    expect(matchesEventPattern("implement.post", "implement.pre")).toBe(false);
  });

  it("`implement.*` spans nested segments, not just one", () => {
    // This is the whole reason `*` matches one-or-more segments: a user
    // writing implement.* means "everything implement emits", including
    // implement.task.post.
    expect(matchesEventPattern("implement.*", "implement.post")).toBe(true);
    expect(matchesEventPattern("implement.*", "implement.task.post")).toBe(true);
    expect(matchesEventPattern("implement.*", "implement.feature.post")).toBe(true);
    expect(matchesEventPattern("implement.*", "fix.post")).toBe(false);
  });

  it("`*.post` matches any depth ending in .post", () => {
    expect(matchesEventPattern("*.post", "fix.post")).toBe(true);
    expect(matchesEventPattern("*.post", "implement.task.post")).toBe(true);
    expect(matchesEventPattern("*.post", "fix.pre")).toBe(false);
  });

  it("a bare `*` matches everything in the catalog", () => {
    for (const e of EVENT_CATALOG) {
      expect(matchesEventPattern("*", e.name)).toBe(true);
    }
  });

  it("does not let regex metacharacters in a pattern match literally", () => {
    // "implement.post" as a pattern must not behave like the regex /implement.post/
    expect(matchesEventPattern("implementXpost", "implement.post")).toBe(false);
  });
});

describe("resolvePattern", () => {
  it("separates planned events from emitted ones", () => {
    const { matched, planned } = resolvePattern("devops.*");
    expect(matched.length).toBeGreaterThan(0);
    expect(planned.length).toBe(matched.length); // devops is entirely planned
  });

  it("reports no planned events for a fully-wired role", () => {
    const { matched, planned } = resolvePattern("implement.*");
    expect(matched.length).toBe(5);
    expect(planned).toEqual([]);
  });

  it("returns nothing for a name outside the catalog", () => {
    expect(resolvePattern("not.a.real.event").matched).toEqual([]);
  });
});

describe("catalog integrity", () => {
  it("has unique event names", () => {
    const names = allEventNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("emits exactly the 7 v1-wired roles plus the cross-cutting hook.error", () => {
    const roles = new Set(EVENT_CATALOG.filter((e) => e.status === "emitted").map((e) => e.role));
    expect([...roles].sort()).toEqual(
      ["*", "brainstorm", "feature", "fix", "implement", "plan", "plan-feature", "review"].sort()
    );
  });

  it("declares 20 emitted events across the wired roles", () => {
    // brainstorm 2 + plan 2 + plan-feature 2 + feature 3 + implement 5
    // + review 3 + fix 2 + hook.error 1 = 20
    expect(emittedEventNames()).toHaveLength(20);
  });

  it("resolves every catalog name through getEvent", () => {
    for (const name of allEventNames()) {
      expect(getEvent(name)?.name).toBe(name);
    }
  });

  it("guarantees `changes` on exactly the events that follow changeset capture", () => {
    const withChanges = EVENT_CATALOG.filter((e) => e.provides.includes("changes")).map((e) => e.name);
    expect(withChanges).toEqual(
      expect.arrayContaining([
        "implement.post",
        "implement.task.post",
        "implement.feature.post",
        "fix.post",
      ])
    );
    // A *.pre event must never claim to provide changes — nothing has been
    // captured yet at that point.
    for (const e of EVENT_CATALOG) {
      if (e.phase === "pre") expect(e.provides).not.toContain("changes");
    }
  });

  it("never guarantees `task` on a non-task event", () => {
    const withTask = EVENT_CATALOG.filter((e) => e.provides.includes("task")).map((e) => e.name);
    expect(withTask.sort()).toEqual(["implement.task.post", "implement.task.pre"]);
  });
});
