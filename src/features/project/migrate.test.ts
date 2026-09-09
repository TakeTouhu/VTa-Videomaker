import { describe, expect, it } from "vitest";
import { migrateProject } from "./migrate";
import { PROJECT_SCHEMA_VERSION } from "@/types/project";
import type { Project } from "@/types/project";
import { createProject } from "./factory";

describe("project migration", () => {
  it("passes a current project through unchanged in substance", () => {
    const project = createProject("Test");
    const migrated = migrateProject(project);
    expect(migrated.name).toBe("Test");
    expect(migrated.version).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("fills in settings that a older file did not have", () => {
    const project = createProject("Test");
    const legacy = {
      ...project,
      settings: { width: 1920, height: 1080, fps: 30 },
    } as unknown as Project;

    const migrated = migrateProject(legacy);
    expect(migrated.settings.autosaveIntervalMs).toBeGreaterThan(0);
    expect(migrated.settings.useProxies).toBe(true);
  });

  it("fills in clip fields added after the file was written", () => {
    const project = createProject("Test");
    const sequence = project.sequences[0]!;
    const legacy = {
      ...project,
      sequences: [
        {
          ...sequence,
          clips: [
            {
              id: "c1",
              mediaId: "m1",
              trackId: sequence.videoTracks[0]!.id,
              startTime: 0,
              sourceIn: 0,
              sourceOut: 5,
            },
          ],
        },
      ],
    } as unknown as Project;

    const clip = migrateProject(legacy).sequences[0]!.clips[0]!;
    expect(clip.speed).toBe(1);
    expect(clip.kind).toBe("media");
    expect(clip.color.saturation).toBe(100);
    expect(clip.transform.opacity).toBe(100);
  });

  it("refuses a project written by a newer version", () => {
    const project = { ...createProject("Test"), version: PROJECT_SCHEMA_VERSION + 1 };
    expect(() => migrateProject(project)).toThrow();
  });
});
