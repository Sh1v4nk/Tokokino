import { describe, expect, it } from "vitest"

import {
  applyClipMuteToSegments,
  clipMuteRanges,
  mutedAt,
  mutingClipAt,
} from "@/lib/editor/audio-timeline"
import type { VideoSegment } from "@/lib/editor/animation-export/video-layer"
import type { AnimationClip, VideoTimelineClip } from "@/lib/editor/state-types"

const clip = (
  id: string,
  startMs: number,
  durationMs: number,
  muted?: boolean
): AnimationClip => ({ id, startMs, durationMs, muted })

const segment = (
  sourceStartMs: number,
  sourceEndMs: number,
  timelineStartMs: number,
  muted = false
): VideoSegment => ({ sourceStartMs, sourceEndMs, timelineStartMs, muted })

describe("clipMuteRanges", () => {
  it("ignores clips with no opinion and zero-length clips", () => {
    expect(
      clipMuteRanges([
        clip("a", 0, 1_000, true),
        clip("b", 1_000, 1_000),
        clip("c", 2_000, 0, true),
      ])
    ).toEqual([{ startMs: 0, endMs: 1_000, muted: true }])
  })
})

describe("mutingClipAt", () => {
  it("claims only its own window", () => {
    const clips = [clip("a", 1_000, 1_000, true)]
    expect(mutingClipAt(clips, 999)).toBeUndefined()
    expect(mutingClipAt(clips, 1_000)?.id).toBe("a")
    expect(mutingClipAt(clips, 2_000)).toBeUndefined()
  })

  it("lets the clip stacked on top decide when two overlap", () => {
    const clips = [
      clip("under", 0, 4_000, true),
      clip("over", 1_000, 1_000, false),
    ]
    expect(mutingClipAt(clips, 1_500)?.id).toBe("over")
    expect(mutingClipAt(clips, 3_000)?.id).toBe("under")
  })
})

describe("mutedAt", () => {
  const videoClips: VideoTimelineClip[] = [
    { id: "video-main", timelineStartMs: 0, startMs: 0, endMs: 4_000 },
  ]

  it("falls through to the device preference with no opinions anywhere", () => {
    expect(
      mutedAt(500, {
        animationClips: [],
        videoClips,
        mediaDurationMs: 4_000,
        defaultMuted: true,
      })
    ).toBe(true)
  })

  it("lets a keyframe clip mute only its own window", () => {
    const animationClips = [clip("a", 1_000, 1_000, true)]
    const at = (ms: number) =>
      mutedAt(ms, {
        animationClips,
        videoClips,
        mediaDurationMs: 4_000,
        defaultMuted: false,
      })
    expect(at(500)).toBe(false)
    expect(at(1_500)).toBe(true)
    expect(at(2_500)).toBe(false)
  })

  it("lets a keyframe clip unmute inside a universally muted video", () => {
    const muted: VideoTimelineClip[] = [{ ...videoClips[0], muted: true }]
    const animationClips = [clip("a", 1_000, 1_000, false)]
    const at = (ms: number) =>
      mutedAt(ms, {
        animationClips,
        videoClips: muted,
        mediaDurationMs: 4_000,
        defaultMuted: true,
      })
    expect(at(500)).toBe(true)
    expect(at(1_500)).toBe(false)
  })
})

describe("applyClipMuteToSegments", () => {
  it("leaves segments untouched when no clip has an opinion", () => {
    const segments = [segment(0, 4_000, 0)]
    expect(applyClipMuteToSegments(segments, [clip("a", 0, 1_000)])).toEqual(
      segments
    )
  })

  it("splits a section at the clip's edges and keeps source timing intact", () => {
    const result = applyClipMuteToSegments(
      [segment(2_000, 6_000, 0)],
      [clip("a", 1_000, 1_000, true)]
    )

    expect(result).toEqual([
      {
        sourceStartMs: 2_000,
        sourceEndMs: 3_000,
        timelineStartMs: 0,
        muted: false,
      },
      {
        sourceStartMs: 3_000,
        sourceEndMs: 4_000,
        timelineStartMs: 1_000,
        muted: true,
      },
      {
        sourceStartMs: 4_000,
        sourceEndMs: 6_000,
        timelineStartMs: 2_000,
        muted: false,
      },
    ])
  })

  it("covers the same span before and after the split", () => {
    const before = [segment(0, 4_000, 0)]
    const after = applyClipMuteToSegments(before, [
      clip("a", 500, 500, true),
      clip("b", 2_000, 1_000, true),
    ])
    const span = (list: VideoSegment[]) =>
      list.reduce((n, s) => n + (s.sourceEndMs - s.sourceStartMs), 0)
    expect(span(after)).toBe(span(before))
    expect(after.filter((s) => s.muted)).toHaveLength(2)
  })

  it("ignores clip windows that fall outside the section", () => {
    const result = applyClipMuteToSegments(
      [segment(0, 1_000, 0)],
      [clip("a", 5_000, 1_000, true)]
    )
    expect(result).toHaveLength(1)
    expect(result[0].muted).toBe(false)
  })
})
