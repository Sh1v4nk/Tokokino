import { render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}))

vi.mock("sonner", () => ({ toast }))

import { EditorProvider } from "@/lib/editor/store/provider"
import { useEditorStore } from "@/lib/editor/store"
import { TEMPLATES } from "@/lib/editor/templates"

const template = TEMPLATES.find((t) => t.category === "image")!

beforeEach(() => {
  useEditorStore.getState().reset()
  window.history.replaceState(null, "", `/app?template=${template.id}`)
})

afterEach(() => {
  window.history.replaceState(null, "", "/editor")
  vi.clearAllMocks()
})

describe("EditorProvider URL template", () => {
  it("opens the template as the starting project without an undo point", () => {
    render(
      <EditorProvider>
        <div />
      </EditorProvider>
    )

    expect(toast.success).toHaveBeenCalledWith(`Applied "${template.name}"`)
    expect(window.location.search).toBe("")
    expect(useEditorStore.getState().past).toEqual([])
    expect(useEditorStore.getState().future).toEqual([])
  })
})
