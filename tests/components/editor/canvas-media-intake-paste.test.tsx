import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useCanvasMediaIntake } from "@/components/editor/canvas/use-canvas-media-intake"
import {
  CanvasPreviewScope,
  CanvasScope,
  useCanvasPreviewMode,
  useCanvasScopeId,
  useEditor,
  useEditorStore,
} from "@/lib/editor/store"
import { createCanvas, DEFAULT_STATE } from "@/lib/editor/store/defaults"

/** CanvasView's media-intake wiring, with its scope-bound actions.
 * `onHandled` fires once per canvas that accepts the paste. */
function Intake({
  isActive,
  onHandled,
}: {
  isActive: boolean
  onHandled: () => void
}) {
  const scopeId = useCanvasScopeId()
  const isCanvasPreview = useCanvasPreviewMode()
  const editor = useEditor()
  useCanvasMediaIntake({
    scopeId,
    isCanvasPreview,
    isActive,
    slotCount: editor.screenshotSlots.length,
    tweet: editor.tweet,
    setScreenshot: editor.setScreenshot,
    setFullPageScreenshot: editor.setFullPageScreenshot,
    setScreenshotSlotImage: editor.setScreenshotSlotImage,
    setTweet: editor.setTweet,
    onNaturalDimsReset: onHandled,
  })
  return null
}

/** jsdom has no ClipboardEvent, so hand-roll the one shape the hook reads. */
function pasteImage() {
  const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
    type: "image/png",
  })
  const event = new Event("paste", { cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: { items: [{ type: file.type, getAsFile: () => file }] },
  })
  window.dispatchEvent(event)
}

/** Drains pending FileReaders so "not called" means never, not "not yet". */
const settle = () => act(() => new Promise((r) => setTimeout(r, 10)))

const screenshotOf = (id: string) =>
  useEditorStore.getState().present.canvases.find((c) => c.id === id)
    ?.screenshot ?? null

const historyLength = () => useEditorStore.getState().past.length

beforeEach(() => {
  useEditorStore.setState({
    past: [],
    future: [],
    present: {
      ...DEFAULT_STATE,
      canvases: [createCanvas("canvas-a"), createCanvas("canvas-b")],
      activeCanvasId: "canvas-b",
    },
    bulkEditMode: true,
  })
})

describe("clipboard paste in Bulk Edit", () => {
  it("lands only on the active canvas, as one undoable step", async () => {
    const handledA = vi.fn()
    const handledB = vi.fn()
    render(
      <>
        <CanvasScope id="canvas-a">
          <Intake isActive={false} onHandled={handledA} />
        </CanvasScope>
        <CanvasScope id="canvas-b">
          <Intake isActive onHandled={handledB} />
        </CanvasScope>
      </>
    )

    pasteImage()

    await waitFor(() =>
      expect(screenshotOf("canvas-b")).toMatch(/^data:image\/png/)
    )
    await settle()
    expect(handledB).toHaveBeenCalledTimes(1)
    expect(handledA).not.toHaveBeenCalled()
    expect(screenshotOf("canvas-a")).toBeNull()
    expect(historyLength()).toBe(1)

    act(() => useEditorStore.getState().undo())

    expect(screenshotOf("canvas-b")).toBeNull()
    expect(historyLength()).toBe(0)
  })

  it("is ignored by a preview of the active canvas", async () => {
    const handledLive = vi.fn()
    const handledPreview = vi.fn()
    render(
      <>
        <CanvasScope id="canvas-b">
          <Intake isActive onHandled={handledLive} />
        </CanvasScope>
        <CanvasScope id="preview-canvas-b">
          <CanvasPreviewScope override={null} sourceCanvasId="canvas-b">
            <Intake isActive onHandled={handledPreview} />
          </CanvasPreviewScope>
        </CanvasScope>
      </>
    )

    pasteImage()

    await waitFor(() => expect(handledLive).toHaveBeenCalledTimes(1))
    await settle()
    expect(handledPreview).not.toHaveBeenCalled()
    expect(historyLength()).toBe(1)
  })
})
