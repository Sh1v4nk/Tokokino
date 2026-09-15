import { beforeEach, describe, expect, it } from "vitest"

import { useEditorStore } from "@/lib/editor/store"
import { HISTORY_LIMIT } from "@/lib/editor/store/defaults"

const store = useEditorStore

function activePadding() {
  const { present } = store.getState()
  return present.canvases.find((c) => c.id === present.activeCanvasId)?.padding
}

/** The current composition, restyled — what a template hands the store. */
function templateWithPadding(padding: number) {
  const incoming = structuredClone(store.getState().present)
  for (const canvas of incoming.canvases) canvas.padding = padding
  return incoming
}

describe("loadTemplateState", () => {
  beforeEach(() => store.getState().reset())

  it("removes every media and crop field from template screenshot slots", () => {
    const slotId = store.getState().addScreenshotSlot()!
    const incoming = structuredClone(store.getState().present)
    const canvas = incoming.canvases.find(
      (item) => item.id === incoming.activeCanvasId
    )!
    const slot = canvas.screenshotSlots.find((item) => item.id === slotId)!
    slot.src = "template-crop.png"
    slot.originalSrc = "template-original.png"
    slot.lastCropRegion = { x: 1, y: 2, width: 300, height: 200 }
    slot.fullPageCapture = { scrollPosition: 480 }

    store.getState().loadTemplateState(incoming)

    const loaded = store
      .getState()
      .present.canvases.find((item) => item.id === incoming.activeCanvasId)!
      .screenshotSlots.find((item) => item.id === slotId)!
    expect(loaded.src).toBeNull()
    expect(loaded.originalSrc).toBeNull()
    expect(loaded.lastCropRegion).toBeNull()
    expect(loaded.fullPageCapture).toBeNull()
  })

  it("starts a fresh history by default", () => {
    store.getState().setPadding(37)
    store.getState().undo()
    expect(store.getState().future).toHaveLength(1)

    store.getState().loadTemplateState(templateWithPadding(96))

    expect(activePadding()).toBe(96)
    expect(store.getState().past).toEqual([])
    expect(store.getState().future).toEqual([])
  })

  it("adds exactly one undo point that restores the previous composition when undoable", () => {
    store.getState().setPadding(37)
    const before = store.getState().present
    const pastLength = store.getState().past.length

    store
      .getState()
      .loadTemplateState(templateWithPadding(96), undefined, { undoable: true })

    expect(activePadding()).toBe(96)
    expect(store.getState().past).toHaveLength(pastLength + 1)

    store.getState().undo()

    expect(store.getState().present).toEqual(before)
    expect(activePadding()).toBe(37)
  })

  it("clears redo history when undoable", () => {
    store.getState().setPadding(37)
    store.getState().undo()
    expect(store.getState().future).toHaveLength(1)

    store
      .getState()
      .loadTemplateState(templateWithPadding(96), undefined, { undoable: true })

    expect(store.getState().future).toEqual([])
  })

  it("caps history at HISTORY_LIMIT like a normal commit", () => {
    const { present } = store.getState()
    const oldest = { ...present }
    store.setState({
      past: [
        oldest,
        ...Array.from({ length: HISTORY_LIMIT - 1 }, () => present),
      ],
    })

    store
      .getState()
      .loadTemplateState(templateWithPadding(96), undefined, { undoable: true })

    const { past } = store.getState()
    expect(past).toHaveLength(HISTORY_LIMIT)
    expect(past[0]).not.toBe(oldest)
    expect(past[past.length - 1]).toBe(present)
  })
})

describe("loadDraftState", () => {
  beforeEach(() => store.getState().reset())

  it("still starts a fresh history when a draft is opened", () => {
    store.getState().setPadding(37)
    store.getState().undo()
    expect(store.getState().future).toHaveLength(1)

    store.getState().loadDraftState(templateWithPadding(96), {
      id: "draft-1",
      name: "Draft",
      updatedAt: null,
    })

    expect(activePadding()).toBe(96)
    expect(store.getState().past).toEqual([])
    expect(store.getState().future).toEqual([])
  })
})
