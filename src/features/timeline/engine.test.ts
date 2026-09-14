import { describe, expect, it } from "vitest";
import * as engine from "./engine";
import { A1, V1, V2, idFactory, makeClip, makeSequence } from "./__tests__/fixtures";

describe("clip duration", () => {
  it("is the source range at unit speed", () => {
    expect(engine.clipDuration(makeClip({ id: "a", sourceIn: 2, sourceOut: 7 }))).toBe(5);
  });

  it("shortens with faster speed and lengthens with slower speed", () => {
    expect(engine.clipDuration(makeClip({ id: "a", sourceOut: 10, speed: 2 }))).toBe(5);
    expect(engine.clipDuration(makeClip({ id: "a", sourceOut: 10, speed: 0.5 }))).toBe(20);
  });

  it("treats a non-positive speed as realtime rather than dividing by zero", () => {
    expect(engine.clipDuration(makeClip({ id: "a", sourceOut: 10, speed: 0 }))).toBe(10);
  });
});

describe("sequenceDuration", () => {
  it("is the end of the last clip on any track", () => {
    const sequence = makeSequence([
      makeClip({ id: "a", startTime: 0, sourceOut: 5 }),
      makeClip({ id: "b", trackId: A1, startTime: 20, sourceOut: 3 }),
    ]);
    expect(engine.sequenceDuration(sequence)).toBe(23);
  });

  it("is zero for an empty sequence", () => {
    expect(engine.sequenceDuration(makeSequence())).toBe(0);
  });
});

describe("insertClip", () => {
  it("adds a clip to an empty track", () => {
    const sequence = engine.insertClip(makeSequence(), makeClip({ id: "a" }));
    expect(sequence.clips).toHaveLength(1);
  });

  it("overwrites the material underneath", () => {
    // b covers 4..10, so a survives only as its 0..4 head.
    const sequence = engine.insertClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]),
      makeClip({ id: "b", startTime: 4, sourceOut: 6 }),
    );
    const a = sequence.clips.find((clip) => clip.id === "a")!;
    expect(engine.clipEnd(a)).toBeCloseTo(4);
    expect(sequence.clips).toHaveLength(2);
  });

  it("splits a clip when the new one lands in its middle", () => {
    const sequence = engine.insertClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]),
      makeClip({ id: "b", startTime: 3, sourceOut: 2 }),
    );
    // Head of a, the new clip, and the tail of a.
    expect(sequence.clips).toHaveLength(3);
    const sorted = engine.clipsOnTrack(sequence, V1);
    expect(sorted.map((clip) => clip.startTime)).toEqual([0, 3, 5]);
  });

  it("leaves other tracks alone", () => {
    const sequence = engine.insertClip(
      makeSequence([makeClip({ id: "a", trackId: V2, startTime: 0, sourceOut: 10 })]),
      makeClip({ id: "b", trackId: V1, startTime: 0, sourceOut: 10 }),
    );
    expect(sequence.clips).toHaveLength(2);
  });
});

describe("moveClip", () => {
  it("moves a clip along its track", () => {
    const sequence = engine.moveClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 5 })]),
      "a",
      10,
    );
    expect(engine.findClip(sequence, "a")!.startTime).toBe(10);
  });

  it("moves a clip to another track", () => {
    const sequence = engine.moveClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 5 })]),
      "a",
      0,
      { trackId: V2 },
    );
    expect(engine.findClip(sequence, "a")!.trackId).toBe(V2);
  });

  it("never moves a clip before zero", () => {
    const sequence = engine.moveClip(
      makeSequence([makeClip({ id: "a", startTime: 2, sourceOut: 5 })]),
      "a",
      -10,
    );
    expect(engine.findClip(sequence, "a")!.startTime).toBe(0);
  });

  it("quantizes to the frame grid when fps is given", () => {
    const sequence = engine.moveClip(
      makeSequence([makeClip({ id: "a", sourceOut: 5 })]),
      "a",
      1.017,
      { fps: 30 },
    );
    expect(engine.findClip(sequence, "a")!.startTime).toBeCloseTo(31 / 30, 5);
  });

  it("refuses to move a clip on a locked track", () => {
    const original = makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 5 })], [V1]);
    expect(engine.moveClip(original, "a", 10)).toBe(original);
  });

  it("keeps the source range intact", () => {
    const sequence = engine.moveClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceIn: 2, sourceOut: 7 })]),
      "a",
      30,
    );
    const clip = engine.findClip(sequence, "a")!;
    expect([clip.sourceIn, clip.sourceOut]).toEqual([2, 7]);
  });
});

describe("trimClip", () => {
  it("trims the head and advances the source in point", () => {
    const sequence = engine.trimClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceIn: 0, sourceOut: 10 })]),
      "a",
      "start",
      3,
    );
    const clip = engine.findClip(sequence, "a")!;
    expect(clip.startTime).toBe(3);
    expect(clip.sourceIn).toBe(3);
    expect(engine.clipDuration(clip)).toBe(7);
  });

  it("trims the tail", () => {
    const sequence = engine.trimClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]),
      "a",
      "end",
      6,
    );
    expect(engine.clipEnd(engine.findClip(sequence, "a")!)).toBeCloseTo(6);
  });

  it("cannot trim the head past the tail", () => {
    const sequence = engine.trimClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]),
      "a",
      "start",
      50,
    );
    expect(engine.clipDuration(engine.findClip(sequence, "a")!)).toBeGreaterThan(0);
  });

  it("cannot extend the head before the start of the source media", () => {
    const sequence = engine.trimClip(
      makeSequence([makeClip({ id: "a", startTime: 5, sourceIn: 2, sourceOut: 10 })]),
      "a",
      "start",
      0,
    );
    const clip = engine.findClip(sequence, "a")!;
    expect(clip.sourceIn).toBeGreaterThanOrEqual(0);
    expect(clip.startTime).toBeCloseTo(3);
  });

  it("cannot extend the tail past the end of the source media", () => {
    const sequence = engine.trimClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceIn: 0, sourceOut: 5 })]),
      "a",
      "end",
      100,
      8,
    );
    expect(engine.findClip(sequence, "a")!.sourceOut).toBeCloseTo(8);
  });

  it("refuses to trim on a locked track", () => {
    const original = makeSequence([makeClip({ id: "a", sourceOut: 10 })], [V1]);
    expect(engine.trimClip(original, "a", "end", 2)).toBe(original);
  });
});

describe("splitClip", () => {
  it("produces two adjacent halves that cover the original range", () => {
    const { sequence, newClipIds } = engine.splitClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceIn: 0, sourceOut: 10 })]),
      "a",
      4,
      idFactory(),
    );
    expect(newClipIds).toHaveLength(2);

    const [head, tail] = engine.clipsOnTrack(sequence, V1);
    expect(engine.clipEnd(head!)).toBeCloseTo(4);
    expect(tail!.startTime).toBeCloseTo(4);
    expect(tail!.sourceIn).toBeCloseTo(4);
    expect(engine.clipDuration(head!) + engine.clipDuration(tail!)).toBeCloseTo(10);
  });

  it("respects speed when mapping the split point into the source", () => {
    const { sequence } = engine.splitClip(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10, speed: 2 })]),
      "a",
      2,
      idFactory(),
    );
    const tail = engine.clipsOnTrack(sequence, V1)[1]!;
    expect(tail.sourceIn).toBeCloseTo(4);
  });

  it("does nothing at the clip boundaries", () => {
    const original = makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]);
    expect(engine.splitClip(original, "a", 0).sequence).toBe(original);
    expect(engine.splitClip(original, "a", 10).sequence).toBe(original);
  });

  it("does nothing on a locked track", () => {
    const original = makeSequence([makeClip({ id: "a", sourceOut: 10 })], [V1]);
    expect(engine.splitClip(original, "a", 5).sequence).toBe(original);
  });
});

describe("splitAt", () => {
  it("splits every crossing clip on the given tracks", () => {
    const sequence = makeSequence([
      makeClip({ id: "a", trackId: V1, startTime: 0, sourceOut: 10 }),
      makeClip({ id: "b", trackId: V2, startTime: 0, sourceOut: 10 }),
    ]);
    const result = engine.splitAt(sequence, 5, undefined, idFactory());
    expect(result.sequence.clips).toHaveLength(4);
  });

  it("skips clips that do not cross the playhead", () => {
    const sequence = makeSequence([makeClip({ id: "a", startTime: 20, sourceOut: 5 })]);
    expect(engine.splitAt(sequence, 5, undefined, idFactory()).sequence.clips).toHaveLength(1);
  });
});

describe("deleteClips", () => {
  it("removes a clip and leaves the gap", () => {
    const sequence = engine.deleteClips(
      makeSequence([
        makeClip({ id: "a", startTime: 0, sourceOut: 5 }),
        makeClip({ id: "b", startTime: 10, sourceOut: 5 }),
      ]),
      ["a"],
    );
    expect(sequence.clips).toHaveLength(1);
    expect(engine.findClip(sequence, "b")!.startTime).toBe(10);
  });

  it("keeps clips on locked tracks", () => {
    const sequence = engine.deleteClips(
      makeSequence([makeClip({ id: "a", sourceOut: 5 })], [V1]),
      ["a"],
    );
    expect(sequence.clips).toHaveLength(1);
  });
});

describe("rippleDeleteClips", () => {
  it("closes the gap on the affected track", () => {
    const sequence = engine.rippleDeleteClips(
      makeSequence([
        makeClip({ id: "a", startTime: 0, sourceOut: 5 }),
        makeClip({ id: "b", startTime: 5, sourceOut: 5 }),
        makeClip({ id: "c", startTime: 10, sourceOut: 5 }),
      ]),
      ["b"],
    );
    expect(engine.clipsOnTrack(sequence, V1).map((clip) => clip.startTime)).toEqual([0, 5]);
  });

  it("does not shift clips on other tracks", () => {
    const sequence = engine.rippleDeleteClips(
      makeSequence([
        makeClip({ id: "a", trackId: V1, startTime: 0, sourceOut: 5 }),
        makeClip({ id: "b", trackId: V2, startTime: 10, sourceOut: 5 }),
      ]),
      ["a"],
    );
    expect(engine.findClip(sequence, "b")!.startTime).toBe(10);
  });

  it("handles several removals on one track", () => {
    const sequence = engine.rippleDeleteClips(
      makeSequence([
        makeClip({ id: "a", startTime: 0, sourceOut: 5 }),
        makeClip({ id: "b", startTime: 5, sourceOut: 5 }),
        makeClip({ id: "c", startTime: 10, sourceOut: 5 }),
        makeClip({ id: "d", startTime: 15, sourceOut: 5 }),
      ]),
      ["b", "c"],
    );
    expect(engine.clipsOnTrack(sequence, V1).map((clip) => clip.startTime)).toEqual([0, 5]);
  });
});

describe("removeRange", () => {
  it("cuts a range out of the middle of a clip and closes the gap", () => {
    const sequence = engine.removeRange(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]),
      V1,
      3,
      5,
      true,
      idFactory(),
    );
    const clips = engine.clipsOnTrack(sequence, V1);
    expect(clips).toHaveLength(2);
    expect(clips[0]!.startTime).toBeCloseTo(0);
    expect(engine.clipEnd(clips[0]!)).toBeCloseTo(3);
    expect(clips[1]!.startTime).toBeCloseTo(3);
    expect(engine.sequenceDuration(sequence)).toBeCloseTo(8);
  });

  it("leaves a gap when ripple is off", () => {
    const sequence = engine.removeRange(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]),
      V1,
      3,
      5,
      false,
      idFactory(),
    );
    expect(engine.sequenceDuration(sequence)).toBeCloseTo(10);
  });

  it("keeps the surviving halves pointing at the right source material", () => {
    const sequence = engine.removeRange(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceIn: 0, sourceOut: 10 })]),
      V1,
      3,
      5,
      true,
      idFactory(),
    );
    const clips = engine.clipsOnTrack(sequence, V1);
    expect(clips[0]!.sourceOut).toBeCloseTo(3);
    expect(clips[1]!.sourceIn).toBeCloseTo(5);
  });

  it("ignores an empty range", () => {
    const original = makeSequence([makeClip({ id: "a", sourceOut: 10 })]);
    expect(engine.removeRange(original, V1, 4, 4, true)).toBe(original);
  });
});

describe("duplicateClips", () => {
  it("places the copy after the source range", () => {
    const { sequence, newClipIds } = engine.duplicateClips(
      makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 5 })]),
      ["a"],
      idFactory(),
    );
    expect(newClipIds).toEqual(["new1"]);
    expect(engine.findClip(sequence, "new1")!.startTime).toBe(5);
  });

  it("deep copies the settings so edits do not leak between copies", () => {
    const { sequence } = engine.duplicateClips(
      makeSequence([makeClip({ id: "a", sourceOut: 5 })]),
      ["a"],
      idFactory(),
    );
    const original = engine.findClip(sequence, "a")!;
    const copy = engine.findClip(sequence, "new1")!;
    expect(copy.color).not.toBe(original.color);
    expect(copy.transform).not.toBe(original.transform);
  });
});

describe("snapping", () => {
  it("collects clip edges, the playhead and the origin", () => {
    const sequence = { ...makeSequence([makeClip({ id: "a", startTime: 2, sourceOut: 3 })]), playhead: 7 };
    expect(engine.snapCandidates(sequence)).toEqual([0, 2, 5, 7]);
  });

  it("excludes the clip being dragged", () => {
    const sequence = makeSequence([makeClip({ id: "a", startTime: 2, sourceOut: 3 })]);
    expect(engine.snapCandidates(sequence, ["a"])).toEqual([0]);
  });

  it("snaps to the closest candidate inside the threshold", () => {
    expect(engine.snapTime(4.9, [0, 5, 10], 0.2)).toBe(5);
  });

  it("leaves the time alone outside the threshold", () => {
    expect(engine.snapTime(4.0, [0, 5, 10], 0.2)).toBe(4.0);
  });
});

describe("track queries", () => {
  it("returns clips on a track in start order", () => {
    const sequence = makeSequence([
      makeClip({ id: "b", startTime: 10, sourceOut: 2 }),
      makeClip({ id: "a", startTime: 0, sourceOut: 2 }),
    ]);
    expect(engine.clipsOnTrack(sequence, V1).map((clip) => clip.id)).toEqual(["a", "b"]);
  });

  it("finds the clip under a time", () => {
    const sequence = makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]);
    expect(engine.clipAt(sequence, V1, 5)?.id).toBe("a");
    expect(engine.clipAt(sequence, V1, 15)).toBeUndefined();
  });

  it("includes a clip's first frame", () => {
    const sequence = makeSequence([makeClip({ id: "a", startTime: 4, sourceOut: 10 })]);
    expect(engine.clipAt(sequence, V1, 4)?.id).toBe("a");
  });

  it("excludes the frame the clip ends on", () => {
    const sequence = makeSequence([makeClip({ id: "a", startTime: 0, sourceOut: 10 })]);
    expect(engine.clipAt(sequence, V1, 10)).toBeUndefined();
  });

  it("returns the second clip when the playhead sits on a cut", () => {
    const sequence = makeSequence([
      makeClip({ id: "a", startTime: 0, sourceOut: 5 }),
      makeClip({ id: "b", startTime: 5, sourceIn: 5, sourceOut: 10 }),
    ]);
    expect(engine.clipAt(sequence, V1, 5)?.id).toBe("b");
  });
});
