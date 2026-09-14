import { beforeEach, describe, expect, it } from "vitest"

import { useEditorStore } from "@/lib/editor/store"

const store = useEditorStore

const activeCanvas = () => {
  const state = store.getState().present
  return state.canvases.find((canvas) => canvas.id === state.activeCanvasId)!
}

const videoClips = () => activeCanvas().videoClips

const durationMs = () => activeCanvas().animation?.durationMs

const initializeVideoClip = () => {
  store.getState().updateVideoClip("video-main", { endMs: 5_000 })
  return videoClips()![0]
}

describe("video timeline store actions", () => {
  beforeEach(() => store.getState().reset())

  it("creates an editable main video section on first update", () => {
    const clip = initializeVideoClip()

    expect(clip).toMatchObject({
      id: "video-main",
      timelineStartMs: 0,
      startMs: 0,
      endMs: 5_000,
    })
  })

  it("splits a section into contiguous source and timeline ranges", () => {
    initializeVideoClip()

    const secondId = store.getState().splitVideoClip("video-main", 2_000)
    const [first, second] = videoClips()!

    expect(secondId).toBeTruthy()
    expect(first).toMatchObject({
      startMs: 0,
      endMs: 2_000,
      timelineStartMs: 0,
    })
    expect(second).toMatchObject({
      id: secondId,
      startMs: 2_000,
      endMs: 5_000,
      timelineStartMs: 2_000,
    })
  })

  it("refuses cuts on a section boundary", () => {
    initializeVideoClip()

    expect(store.getState().splitVideoClip("video-main", 0)).toBeNull()
    expect(store.getState().splitVideoClip("video-main", 5_000)).toBeNull()
    expect(videoClips()).toHaveLength(1)
  })

  it("keeps mute state isolated to the updated section", () => {
    initializeVideoClip()
    const secondId = store.getState().splitVideoClip("video-main", 2_000)!

    store.getState().updateVideoClip(secondId, { muted: true })

    const [first, second] = videoClips()!
    expect(first.muted).toBeUndefined()
    expect(second.muted).toBe(true)
  })

  it("duplicates a section after its source and materializes an open-ended range", () => {
    // An unsplit source has no explicit end until the timeline knows its media
    // length. Duplicate receives that resolved duration from the UI.
    const duplicatedId = store
      .getState()
      .duplicateVideoClip("video-main", 5_000)
    const [original, duplicate] = videoClips()!

    expect(duplicatedId).toBeTruthy()
    expect(original.endMs).toBe(5_000)
    expect(duplicate).toMatchObject({
      id: duplicatedId,
      startMs: 0,
      endMs: 5_000,
      timelineStartMs: 5_000,
    })
  })

  it("inserts a duplicate into the next occupied position and ripples its successor", () => {
    initializeVideoClip()
    const secondId = store.getState().splitVideoClip("video-main", 2_000)!

    const duplicatedId = store
      .getState()
      .duplicateVideoClip("video-main", 2_000)!
    const clips = videoClips()!
    const duplicate = clips.find((clip) => clip.id === duplicatedId)!
    const successor = clips.find((clip) => clip.id === secondId)!

    expect(duplicate.timelineStartMs).toBe(2_000)
    expect(successor.timelineStartMs).toBe(4_000)
  })

  it("deletes only the requested section and restores it with undo", () => {
    initializeVideoClip()
    const secondId = store.getState().splitVideoClip("video-main", 2_000)!

    store.getState().removeVideoClips([secondId])
    expect(videoClips()).toHaveLength(1)

    store.getState().undo()
    expect(videoClips()).toHaveLength(2)
  })

  it("clears the canvas media when the last section is deleted", () => {
    initializeVideoClip()

    store.getState().removeVideoClips(["video-main"])

    const state = store.getState().present
    const canvas = state.canvases.find(
      (item) => item.id === state.activeCanvasId
    )!
    expect(canvas.screenshot).toBeNull()
    expect(canvas.videoClips).toBeNull()
  })

  describe("timeline duration follows the video track", () => {
    it("shrinks the duration to a trimmed section", () => {
      store.getState().setAnimationDuration(34_000)

      store.getState().updateVideoClip("video-main", { endMs: 2_000 })

      expect(durationMs()).toBe(2_000)
    })

    it("grows the duration when a section is extended", () => {
      initializeVideoClip()

      store.getState().updateVideoClip("video-main", { endMs: 9_000 })

      expect(durationMs()).toBe(9_000)
    })

    it("leaves a hand-set duration alone when the track end has not moved", () => {
      initializeVideoClip()
      store.getState().setAnimationDuration(2_000)

      // What a click on the section commits: a position it already has.
      store.getState().updateVideoClip("video-main", { timelineStartMs: 0 })

      expect(durationMs()).toBe(2_000)
    })

    it("keeps a mute toggle from resizing the timeline", () => {
      initializeVideoClip()
      store.getState().setAnimationDuration(2_000)

      store.getState().updateVideoClip("video-main", { muted: true })

      expect(durationMs()).toBe(2_000)
    })

    it("pulls a hand-set duration in, but never pushes it back out", () => {
      initializeVideoClip()
      store.getState().setAnimationDuration(2_000)

      // Trimming past the hand-set end leaves the user's choice standing.
      store.getState().updateVideoClip("video-main", { endMs: 3_000 })
      expect(durationMs()).toBe(2_000)

      // Trimming inside it has to win — there is no footage left out there.
      store.getState().updateVideoClip("video-main", { endMs: 1_000 })
      expect(durationMs()).toBe(1_000)
    })

    it("measures the track end, not the source range", () => {
      initializeVideoClip()
      const secondId = store.getState().splitVideoClip("video-main", 2_000)
      store.getState().removeVideoClips(["video-main"])

      // The kept section plays source 2s–5s but sits at 2s on the timeline.
      expect(videoClips()!.map((clip) => clip.id)).toEqual([secondId])
      expect(durationMs()).toBe(5_000)
    })

    it("never trims below the last keyframe", () => {
      store.getState().setAnimationDuration(34_000)
      const clipId = store.getState().addAnimationClip(undefined, 8_000)

      store.getState().updateVideoClip("video-main", { endMs: 2_000 })

      const keyframe = activeCanvas().animation!.clips.find(
        (clip) => clip.id === clipId
      )!
      expect(durationMs()).toBe(keyframe.startMs + keyframe.durationMs)
    })

    it("leaves the duration alone for an open-ended section", () => {
      store.getState().setAnimationDuration(34_000)

      store.getState().updateVideoClip("video-main", { timelineStartMs: 1_000 })

      expect(durationMs()).toBe(34_000)
    })

    it("restores the duration with undo", () => {
      store.getState().setAnimationDuration(34_000)
      store.getState().updateVideoClip("video-main", { endMs: 2_000 })

      store.getState().undo()

      expect(durationMs()).toBe(34_000)
    })
  })
})
