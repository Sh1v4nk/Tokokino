import { describe, expect, it } from "vitest"

import { planFrames } from "@/lib/editor/animation-export/video-media/frames"
import type { VideoTimelineClip } from "@/lib/editor/state-types"

const SOURCE_SEC = 10

describe("planFrames", () => {
  it("plays the whole source when nothing is trimmed", () => {
    const plan = planFrames(SOURCE_SEC, 30)
    expect(plan.frameCount).toBe(300)
    expect(plan.sourceTimeForFrame(0)).toBeCloseTo(0)
    expect(plan.sourceTimeForFrame(150)).toBeCloseTo(5)
  })

  it("sizes the output from the trimmed track", () => {
    const clips: VideoTimelineClip[] = [
      { id: "a", timelineStartMs: 0, startMs: 0, endMs: 2_000 },
    ]
    expect(planFrames(SOURCE_SEC, 30, clips).frameCount).toBe(60)
  })

  it("lets the timeline duration shorten the output below the track", () => {
    const clips: VideoTimelineClip[] = [
      { id: "a", timelineStartMs: 0, startMs: 0, endMs: 4_000 },
    ]
    expect(planFrames(SOURCE_SEC, 30, clips, 1).frameCount).toBe(30)
  })

  it("starts the export at the trim's in-point", () => {
    const clips: VideoTimelineClip[] = [
      { id: "a", timelineStartMs: 0, startMs: 6_000, endMs: 8_000 },
    ]
    const plan = planFrames(SOURCE_SEC, 30, clips)
    expect(plan.sourceTimeForFrame(0)).toBeCloseTo(6)
    expect(plan.sourceTimeForFrame(30)).toBeCloseTo(7)
  })

  it("keeps presentation timestamps on the output clock, not the source", () => {
    // A split played out of source order: source time runs backwards across the
    // cut, so stamping frames with it would hand the muxer decreasing
    // timestamps. The output clock has to stay monotonic at 1/fps.
    const clips: VideoTimelineClip[] = [
      { id: "a", timelineStartMs: 0, startMs: 6_000, endMs: 8_000 },
      { id: "b", timelineStartMs: 2_000, startMs: 1_000, endMs: 3_000 },
    ]
    const plan = planFrames(SOURCE_SEC, 30, clips)

    expect(plan.sourceTimeForFrame(0)).toBeCloseTo(6)
    expect(plan.sourceTimeForFrame(60)).toBeCloseTo(1)
    expect(plan.sourceTimeForFrame(60)).toBeLessThan(plan.sourceTimeForFrame(0))

    const stamps = Array.from({ length: plan.frameCount }, (_, i) =>
      plan.timeForFrame(i)
    )
    expect(stamps[0]).toBe(0)
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] - stamps[i - 1]).toBeCloseTo(plan.frameDurationSec)
    }
  })

  it("never repeats a timestamp across a gap in the track", () => {
    const clips: VideoTimelineClip[] = [
      { id: "a", timelineStartMs: 0, startMs: 0, endMs: 1_000 },
      { id: "b", timelineStartMs: 3_000, startMs: 1_000, endMs: 2_000 },
    ]
    const plan = planFrames(SOURCE_SEC, 30, clips)

    // The gap holds a held frame, so source time repeats there.
    expect(plan.sourceTimeForFrame(45)).toBeCloseTo(plan.sourceTimeForFrame(60))

    const stamps = new Set(
      Array.from({ length: plan.frameCount }, (_, i) => plan.timeForFrame(i))
    )
    expect(stamps.size).toBe(plan.frameCount)
  })
})
