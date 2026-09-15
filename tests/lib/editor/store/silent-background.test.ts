import { beforeEach, describe, expect, it, vi } from "vitest"

import { useEditorStore } from "@/lib/editor/store"
import type { Background } from "@/lib/editor/state-types"

const store = useEditorStore

const activeCanvas = () => {
  const s = store.getState().present
  return s.canvases.find((c) => c.id === s.activeCanvasId)!
}
const clips = () => activeCanvas().animation!.clips

// Enter Animate mode with a single clip open for editing — the state a restored
// draft lands in, and where a stray setBackground would be recorded as a keyframe.
const enterAnimateWithOpenClip = () => {
  const id = store.getState().addAnimationClip()
  store.getState().setIsAnimateMode(true)
  store.getState().selectAnimationClip(id)
  return id
}

describe("setBackground silent option", () => {
  beforeEach(() => store.getState().reset())

  it("does not record a 'background' keyframe effect when silent", () => {
    const id = enterAnimateWithOpenClip()
    const next: Background = {
      type: "image",
      value: "data:image/png;base64,optimized",
      sourceUrl: activeCanvas().background.sourceUrl,
    }

    store.getState().setBackground(next, undefined, { silent: true })

    // The hydration/downscale swap must not mark the open clip as animating the
    // background — that's what spuriously showed the palette icon on reload.
    expect(clips().find((c) => c.id === id)?.effects ?? []).not.toContain(
      "background"
    )
    expect(activeCanvas().background.value).toBe(next.value)
  })

  it("still records the effect for a real user edit (non-silent)", () => {
    const id = enterAnimateWithOpenClip()

    store.getState().setBackground({ type: "solid", value: "#ff0000" })

    expect(clips().find((c) => c.id === id)?.effects ?? []).toContain(
      "background"
    )
  })

  it("syncs matching clip poses to the optimized value", () => {
    const id = enterAnimateWithOpenClip()
    const sourceUrl = activeCanvas().background.sourceUrl
    // The clip's pose was captured with the pre-optimization background value.
    expect(clips().find((c) => c.id === id)?.pose?.background.sourceUrl).toBe(
      sourceUrl
    )

    const optimized: Background = {
      type: "image",
      value: "data:image/png;base64,optimized",
      sourceUrl,
    }
    store.getState().setBackground(optimized, undefined, { silent: true })

    // Re-selecting the clip reloads its pose onto the canvas; the pose must hold
    // the optimized value so it doesn't revert to the un-downscaled image.
    expect(clips().find((c) => c.id === id)?.pose?.background.value).toBe(
      optimized.value
    )
  })
})

describe("setBackground silent option — history", () => {
  const optimized = (): Background => ({
    type: "image",
    value: "data:image/png;base64,optimized",
    sourceUrl: activeCanvas().background.sourceUrl,
  })

  beforeEach(() => {
    store.getState().reset()
    // A fresh editor: nothing to undo or redo, no merge group open.
    store.setState({ past: [], future: [], _lastGroup: null, _lastTs: 0 })
  })

  it("does not add an undo step on an untouched editor", () => {
    const next = optimized()

    store.getState().setBackground(next, undefined, { silent: true })

    expect(store.getState().past).toEqual([])
    expect(activeCanvas().background).toEqual(next)
  })

  it("leaves past and the open merge group untouched", () => {
    store.getState().setPadding(80)
    const { past, _lastGroup, _lastTs } = store.getState()
    expect(_lastGroup).toBe("padding")

    store.getState().setBackground(optimized(), undefined, { silent: true })

    const after = store.getState()
    expect(after.past).toBe(past)
    expect(after._lastGroup).toBe(_lastGroup)
    expect(after._lastTs).toBe(_lastTs)
  })

  it("preserves redo", () => {
    store.getState().setPadding(80)
    store.getState().undo()
    const { future } = store.getState()
    expect(future).toHaveLength(1)

    store.getState().setBackground(optimized(), undefined, { silent: true })
    expect(store.getState().future).toBe(future)

    store.getState().redo()
    expect(activeCanvas().padding).toBe(80)
    expect(store.getState().future).toEqual([])
  })

  it("targets the given canvas only", () => {
    const secondId = store.getState().addCanvas()!
    const { past } = store.getState()
    const first = store.getState().present.canvases[0]
    const next = optimized()

    store.getState().setBackground(next, secondId, { silent: true })

    const canvases = store.getState().present.canvases
    expect(canvases.find((c) => c.id === secondId)?.background).toEqual(next)
    expect(canvases[0]).toBe(first)
    expect(store.getState().past).toBe(past)
  })

  it("still notifies store subscribers", () => {
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.getState().setBackground(optimized(), undefined, { silent: true })

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("records a real user edit in history", () => {
    store.getState().setBackground({ type: "solid", value: "#ff0000" })

    const s = store.getState()
    expect(s.past).toHaveLength(1)
    expect(s.future).toEqual([])
    expect(s._lastGroup).toBe("background")
    expect(activeCanvas().background.value).toBe("#ff0000")
  })
})
