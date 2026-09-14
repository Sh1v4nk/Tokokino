/**
 * Per-frame plumbing shared by the GIF and MP4/WebM encoders: the output frame
 * plan (how many frames and at what times) and blitting a captured frame onto
 * the encode canvas.
 */

import type { VideoTimelineClip } from "../../state-types"
import { safeDrawImage } from "../draw-utils"
import type { WatermarkAssets } from "../types"
import {
  resolveVideoSegments,
  resolveVideoSourceTimeMs,
  type VideoSegment,
} from "../video-layer"
import { drawWatermark } from "../watermark"

export type FramePlan = {
  frameCount: number
  frameDurationSec: number
  timeForFrame: (i: number) => number
}

/** Where the video track ends on the timeline, in seconds. */
function trackEndSec(segments: readonly VideoSegment[]): number {
  return (
    segments.reduce(
      (end, segment) =>
        Math.max(
          end,
          segment.timelineStartMs +
            (segment.sourceEndMs - segment.sourceStartMs)
        ),
      0
    ) / 1000
  )
}

/**
 * Frame plan for the export: how many frames, and which SOURCE time each one
 * shows.
 *
 * Length is the TIMELINE's, not the source clip's — those agree only for an
 * untrimmed video parked at zero, and sizing by the source is what made a
 * two-second trim export the whole original. `outputDurationSec` is the
 * timeline's own duration (the draggable end handle), so shortening the timeline
 * shortens the export even when the video track runs longer; it falls back to
 * the end of the video track for a canvas that has no timeline yet. No arbitrary
 * ceiling, so a 20-minute clip still exports all 20 minutes; both encoders stream
 * frames, so a high count doesn't blow up memory, and the only guard is against a
 * non-finite duration so the loop can't run away. Cadence is a constant 1/fps →
 * smooth, correct speed.
 *
 * `timeForFrame` maps output position → source position through the segments, so
 * a trim that starts 10s in starts the export there too. Past the track's end, or
 * in a gap, it holds the nearest edge — the frozen frame the Animate player shows
 * in the same spot.
 */
export function planFrames(
  sourceDurationSec: number,
  fps: number,
  clips: readonly VideoTimelineClip[] = [],
  outputDurationSec?: number
): FramePlan {
  const safeDuration =
    Number.isFinite(sourceDurationSec) && sourceDurationSec > 0
      ? sourceDurationSec
      : 0
  const sourceDurationMs = safeDuration * 1000
  const segments = resolveVideoSegments(clips, sourceDurationMs)
  const outputSec =
    outputDurationSec !== undefined &&
    Number.isFinite(outputDurationSec) &&
    outputDurationSec > 0
      ? outputDurationSec
      : trackEndSec(segments)
  const frameCount = Math.max(1, Math.round(outputSec * fps))
  return {
    frameCount,
    frameDurationSec: 1 / fps,
    timeForFrame: (i) => {
      const timelineMs = (i * 1000) / fps
      const sourceMs = resolveVideoSourceTimeMs(
        clips,
        timelineMs,
        sourceDurationMs
      )
      if (sourceMs !== null) return sourceMs / 1000
      // Gap, or the rounded last frame landing a hair past the final segment.
      // Hold the edge of whichever segment is nearest rather than emitting 0.
      let nearest = segments[0]
      let bestDistance = Infinity
      for (const segment of segments) {
        const length = segment.sourceEndMs - segment.sourceStartMs
        const distance =
          timelineMs < segment.timelineStartMs
            ? segment.timelineStartMs - timelineMs
            : timelineMs - (segment.timelineStartMs + length)
        if (distance < bestDistance) {
          bestDistance = distance
          nearest = segment
        }
      }
      if (!nearest) return 0
      return (
        (timelineMs < nearest.timelineStartMs
          ? nearest.sourceStartMs
          : nearest.sourceEndMs) / 1000
      )
    },
  }
}

/** A rendered frame for output frame `i`, sized to the capture, not the encoder. */
export type RenderFrame = (i: number) => Promise<HTMLCanvasElement>

/** Draw a captured frame canvas into the (even-sized) encode canvas + watermark. */
export function blitFrame(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  width: number,
  height: number,
  watermark: WatermarkAssets | null
) {
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, width, height)
  safeDrawImage(ctx, frame, 0, 0, width, height)
  if (watermark) drawWatermark(ctx, width, height, watermark)
}
