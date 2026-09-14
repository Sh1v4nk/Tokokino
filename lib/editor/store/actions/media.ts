import {
  keyframeTrackEndMs,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  resolveRippleDrop,
  videoTrackEndMs,
} from "../../animation-timeline"
import type { CanvasState, VideoTimelineClip } from "../../state-types"
import { getCanvasAnimation } from "../animation-helpers"
import { makeId } from "../canvas-helpers"
import { computeNextLayerZ } from "../layer-stack"
import type { CommitContext } from "../commit-context"
import type { EditorActions } from "../types"

const DEFAULT_VIDEO_CLIPS: VideoTimelineClip[] = [
  { id: "video-main", timelineStartMs: 0, startMs: 0, endMs: null },
]

/**
 * Fit the animation timeline to the video track after a trim. `durationMs` is
 * stamped with the full source length when the video is imported, and both the
 * player and the export read it rather than the clips — so without this a
 * two-second trim still renders the whole original, the tail holding the clip's
 * last painted frame.
 *
 * The timeline's length is still the user's to set with the end handle, so this
 * only reacts when the track's end actually moves (a mute, a selection, a
 * dropped-where-it-was drag must not disturb it), and once the duration no
 * longer matches the track it has been set by hand: a shrinking track may then
 * pull it in, while a growing one leaves it exactly where it was. Returns null
 * when nothing should change, including for an open-ended section whose true
 * length the store cannot know.
 */
const fitDurationToContent = (
  canvas: CanvasState,
  videoClips: readonly VideoTimelineClip[]
) => {
  const nextEnd = videoTrackEndMs(videoClips)
  if (nextEnd === null) return null
  const previousEnd = videoTrackEndMs(canvas.videoClips ?? DEFAULT_VIDEO_CLIPS)
  if (previousEnd === nextEnd) return null
  const animation = getCanvasAnimation(canvas)
  const follows = previousEnd === null || previousEnd === animation.durationMs
  const grew = previousEnd !== null && nextEnd > previousEnd
  const handSet = grew
    ? animation.durationMs
    : Math.min(animation.durationMs, nextEnd)
  const durationMs = Math.min(
    MAX_DURATION_MS,
    Math.max(
      MIN_DURATION_MS,
      follows ? nextEnd : handSet,
      keyframeTrackEndMs(animation.clips)
    )
  )
  return durationMs === animation.durationMs
    ? null
    : { animation: { ...animation, durationMs } }
}

export const createMediaActions = ({
  commitCanvas,
  commitCanvasEffect,
}: CommitContext) =>
  ({
    setScreenshot: (screenshot, canvasId) => {
      commitCanvas(
        canvasId,
        (canvas) => ({
          screenshot,
          originalScreenshot: screenshot,
          lastCropRegion: null,
          fullPageCapture: null,
          videoClips: null,
          // A screenshot replaces any tweet as the canvas's main content.
          tweet: screenshot ? null : canvas.tweet,
          objectFit: canvas.objectFit ?? "contain",
          screenshotLayer: {
            ...canvas.screenshotLayer,
            zIndex:
              screenshot && !canvas.screenshot
                ? computeNextLayerZ(canvas)
                : canvas.screenshotLayer.zIndex,
            hidden: false,
          },
        }),
        null
      )
    },
    setFullPageScreenshot: (src, canvasId) => {
      commitCanvas(
        canvasId,
        (canvas) => ({
          screenshot: src,
          originalScreenshot: src,
          lastCropRegion: null,
          fullPageCapture: src ? { scrollPosition: 0 } : null,
          videoClips: null,
          // A URL capture replaces any tweet as the canvas's main content.
          tweet: src ? null : canvas.tweet,
          objectFit: canvas.objectFit ?? "contain",
          screenshotLayer: {
            ...canvas.screenshotLayer,
            zIndex:
              src && !canvas.screenshot
                ? computeNextLayerZ(canvas)
                : canvas.screenshotLayer.zIndex,
            hidden: false,
          },
        }),
        null
      )
    },
    setFullPageScreenshotScrollPosition: (scrollPosition, canvasId) =>
      commitCanvas(
        canvasId,
        (canvas) => ({
          fullPageCapture: canvas.fullPageCapture
            ? { scrollPosition: Math.max(0, Math.min(100, scrollPosition)) }
            : canvas.fullPageCapture,
        }),
        "full-page-scroll"
      ),
    applyCroppedScreenshot: (s, region, canvasId) =>
      commitCanvas(
        canvasId,
        { screenshot: s, lastCropRegion: region, fullPageCapture: null },
        "applyCroppedScreenshot"
      ),
    setScreenshotCropRegion: (region, canvasId) =>
      commitCanvasEffect(
        canvasId,
        (canvas) => ({
          lastCropRegion: region,
          fullPageCapture: region ? null : canvas.fullPageCapture,
        }),
        "setScreenshotCropRegion",
        "crop"
      ),
    updateVideoClip: (id, patch, canvasId) =>
      commitCanvas(
        canvasId,
        (canvas) => {
          const clips = canvas.videoClips ?? DEFAULT_VIDEO_CLIPS
          const videoClips = clips.map((clip) =>
            clip.id === id ? { ...clip, ...patch } : clip
          )
          return { videoClips, ...fitDurationToContent(canvas, videoClips) }
        },
        "video-trim"
      ),
    splitVideoClip: (id, atMs, canvasId) => {
      let newId: string | null = null
      commitCanvas(
        canvasId,
        (canvas) => {
          const clips = canvas.videoClips ?? DEFAULT_VIDEO_CLIPS
          const clip = clips.find((item) => item.id === id)
          if (
            !clip ||
            atMs <= clip.startMs ||
            (clip.endMs !== null && atMs >= clip.endMs)
          ) {
            return {}
          }
          newId = makeId()
          const videoClips = clips.flatMap((item) =>
            item.id === id
              ? [
                  { ...item, endMs: atMs },
                  {
                    ...item,
                    id: newId!,
                    timelineStartMs:
                      (item.timelineStartMs ?? item.startMs) +
                      (atMs - item.startMs),
                    startMs: atMs,
                  },
                ]
              : [item]
          )
          return { videoClips, ...fitDurationToContent(canvas, videoClips) }
        },
        "video-split"
      )
      return newId
    },
    duplicateVideoClip: (id, durationMs, canvasId) => {
      let newId: string | null = null
      commitCanvas(
        canvasId,
        (canvas) => {
          const clips = canvas.videoClips ?? DEFAULT_VIDEO_CLIPS
          const source = clips.find((clip) => clip.id === id)
          if (!source || durationMs <= 0) return {}
          const sourceStart = source.timelineStartMs ?? source.startMs
          const sourceEndMs = source.endMs ?? source.startMs + durationMs
          const { startMs, shiftAfterMs, shiftMs } = resolveRippleDrop(
            sourceStart + durationMs,
            durationMs,
            clips
              .filter((clip) => clip.id !== id)
              .map((clip) => ({
                startMs: clip.timelineStartMs ?? clip.startMs,
                durationMs:
                  clip.endMs === null ? durationMs : clip.endMs - clip.startMs,
              })),
            MAX_DURATION_MS
          )
          newId = makeId()
          const videoClips = [
            ...clips.map((clip) => {
              const timelineStartMs = clip.timelineStartMs ?? clip.startMs
              const positioned =
                timelineStartMs < shiftAfterMs
                  ? clip
                  : { ...clip, timelineStartMs: timelineStartMs + shiftMs }
              return clip.id === id && clip.endMs === null
                ? { ...positioned, endMs: sourceEndMs }
                : positioned
            }),
            {
              ...source,
              id: newId,
              endMs: sourceEndMs,
              timelineStartMs: startMs,
            },
          ]
          return { videoClips, ...fitDurationToContent(canvas, videoClips) }
        },
        "video-duplicate"
      )
      return newId
    },
    removeVideoClips: (ids, canvasId) =>
      commitCanvas(
        canvasId,
        (canvas) => {
          const clips = canvas.videoClips ?? DEFAULT_VIDEO_CLIPS
          const kept = clips.filter((clip) => !ids.includes(clip.id))
          return kept.length > 0
            ? { videoClips: kept, ...fitDurationToContent(canvas, kept) }
            : {
                screenshot: null,
                originalScreenshot: null,
                videoClips: null,
                fullPageCapture: null,
              }
        },
        "video-delete"
      ),
  }) satisfies Partial<EditorActions>
