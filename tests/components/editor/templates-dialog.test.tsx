import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Template } from "@/lib/editor/templates"

vi.mock("motion/react", async () => {
  const React = await import("react")
  return {
    LayoutGroup: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get:
          (_t, tag: string) =>
          ({ children, ...props }: Record<string, unknown>) =>
            React.createElement(
              tag,
              Object.fromEntries(
                Object.entries(props).filter(
                  ([k]) =>
                    !["layoutId", "transition", "initial", "animate"].includes(
                      k
                    )
                )
              ),
              children as React.ReactNode
            ),
      }
    ),
  }
})

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

const template: Template = {
  id: "browser-dark",
  name: "Browser Dark",
  category: "image",
  thumbnail: "https://assets.example.com/templates/browser-dark.jpg",
  state: {} as Template["state"],
}

vi.mock("@/lib/editor/templates", () => ({
  templatesForTab: () => [template],
  templateCountForTab: () => 1,
  templateTabLabel: (tab: string) => tab,
}))

import { TemplatesDialog } from "@/components/editor/templates/templates-dialog"

const card = () => screen.getByRole("button", { name: /Browser Dark/ })

describe("TemplatesDialog", () => {
  it("applies a template immediately when there is no unsaved work", async () => {
    const onApply = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TemplatesDialog
        open
        onOpenChange={onOpenChange}
        onApply={onApply}
        hasUnsavedWork={false}
      />
    )

    await user.click(card())

    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledWith(template)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("asks before replacing unsaved work instead of applying", async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <TemplatesDialog
        open
        onOpenChange={() => {}}
        onApply={onApply}
        hasUnsavedWork
      />
    )

    await user.click(card())

    expect(onApply).not.toHaveBeenCalled()
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByText("Apply template?")).toBeInTheDocument()
  })

  it("applies the staged template on confirm", async () => {
    const onApply = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TemplatesDialog
        open
        onOpenChange={onOpenChange}
        onApply={onApply}
        hasUnsavedWork
      />
    )

    await user.click(card())
    await user.click(
      await screen.findByRole("button", { name: "Apply Template" })
    )

    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledWith(template)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("leaves the composition alone on cancel", async () => {
    const onApply = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TemplatesDialog
        open
        onOpenChange={onOpenChange}
        onApply={onApply}
        hasUnsavedWork
      />
    )

    await user.click(card())
    await user.click(await screen.findByRole("button", { name: "Cancel" }))

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    )
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
