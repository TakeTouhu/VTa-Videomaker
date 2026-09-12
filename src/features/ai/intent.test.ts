import { describe, expect, it } from "vitest";
import { matchIntent, parseTargetDuration } from "./intent";

describe("parseTargetDuration", () => {
  it("reads minutes", () => {
    expect(parseTargetDuration("3分以内にまとめて")).toBe(180);
  });

  it("reads seconds", () => {
    expect(parseTargetDuration("90秒にして")).toBe(90);
  });

  it("reads minutes and seconds together", () => {
    expect(parseTargetDuration("1分30秒にまとめて")).toBe(90);
  });

  it("reads hours", () => {
    expect(parseTargetDuration("1時間30分にして")).toBe(5400);
  });

  it("reads English durations", () => {
    expect(parseTargetDuration("cut it to 5 minutes")).toBe(300);
  });

  it("returns null when no duration is stated", () => {
    expect(parseTargetDuration("無音を削除して")).toBeNull();
  });

  it("ignores a zero duration", () => {
    expect(parseTargetDuration("0分にして")).toBeNull();
  });
});

describe("matchIntent", () => {
  it("recognises silence removal", () => {
    expect(matchIntent("無音部分を全部削除して").kind).toBe("silence");
    expect(matchIntent("話していないところを削除").kind).toBe("silence");
    expect(matchIntent("remove the silence").kind).toBe("silence");
  });

  it("recognises filler and restatement removal", () => {
    expect(matchIntent("言い直しを削除して").kind).toBe("filler");
    expect(matchIntent("フィラーを消して").kind).toBe("filler");
  });

  it("recognises condensing with a target", () => {
    const intent = matchIntent("3分以内にまとめて");
    expect(intent).toEqual({ kind: "condense", targetSeconds: 180 });
  });

  it("treats a bare duration as a condense request", () => {
    expect(matchIntent("5分にして")).toEqual({ kind: "condense", targetSeconds: 300 });
  });

  it("prefers condensing when a request mentions both silence and a length", () => {
    expect(matchIntent("無音を削除して3分にまとめて")).toEqual({
      kind: "condense",
      targetSeconds: 180,
    });
  });

  it("returns unknown for a request the built-ins do not cover", () => {
    expect(matchIntent("最初の30秒をもっとインパクトのある構成にして").kind).not.toBe(
      "unknown",
    );
    expect(matchIntent("映画っぽい色にして").kind).toBe("unknown");
    expect(matchIntent("人物の顔だけ明るくして").kind).toBe("unknown");
  });
});
