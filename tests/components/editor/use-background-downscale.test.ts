import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useBackgroundDownscale } from "@/components/editor/canvas/use-background-downscale"
import { downscaleImageFromUrl } from "@/lib/editor/image-resize"
import { useEditorStore } from "@/lib/editor/store"

const { OPTIMIZED } = vi.hoisted(() => ({
  OPTIMIZED: "data:image/jpeg;base64,downscaled",
}))

// A fresh page load: nothing is cached yet, so the downscale is async.
vi.mock("@/lib/editor/image-resize", () => ({
  getOptimizedUrlSync: vi.fn(() => null),
  downscaleImageFromUrl: vi.fn(() => Promise.resolve(OPTIMIZED)),
}))

const store = useEditorStore

const activeCanvas = () => {
  const s = store.getState().present
  return s.canvases.find((c) => c.id === s.activeCanvasId)!
}

describe("useBackgroundDownscale", () => {
  beforeEach(() => {
    store.getState().reset()
    store.setState({ past: [], future: [], _lastGroup: null, _lastTs: 0 })
  })

  it("swaps in the downscaled default background without touching history", async () => {
    const { background, id } = activeCanvas()
    expect(background.type).toBe("image")
    expect(background.value).not.toMatch(/^data:/)

    renderHook(() => useBackgroundDownscale(background, id))

    await waitFor(() => expect(activeCanvas().background.value).toBe(OPTIMIZED))
    expect(downscaleImageFromUrl).toHaveBeenCalledWith(
      background.sourceUrl,
      expect.anything()
    )
    expect(activeCanvas().background.sourceUrl).toBe(background.sourceUrl)

    // The swap is internal: Undo stays disabled on the untouched editor.
    const s = store.getState()
    expect(s.past).toEqual([])
    expect(s.future).toEqual([])
    expect(s._lastGroup).toBeNull()
  })
})
