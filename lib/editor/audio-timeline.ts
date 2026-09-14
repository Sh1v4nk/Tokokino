import type { AnimationClip, VideoTimelineClip } from "./state-types"
import type { VideoSegment } from "./animation-export/video-layer"
import { videoClipAtTime } from "./video-timeline-map"

/**
 * Who owns the audio at a given point on the timeline.
 *
 * Two layers, and the narrower one wins. A keyframe clip's `muted` applies to
 * its own window and nothing else — that is the "mute this layer" control. The
 * video section's `muted` (falling back to the device preference) is the
 * universal one, and covers every moment no keyframe clip has claimed.
 */

type MuteRange = { startMs: number; endMs: number; muted: boolean }

/** The keyframe clips that carry an explicit mute, as plain timeline ranges. */
export function clipMuteRanges(clips: readonly AnimationClip[]): MuteRange[] {
  const ranges: MuteRange[] = []
  for (const clip of clips) {
    if (clip.muted === undefined) continue
    if (clip.durationMs <= 0) continue
    ranges.push({
      startMs: clip.startMs,
      endMs: clip.startMs + clip.durationMs,
      muted: clip.muted,
    })
  }
  return ranges
}

/** The last range covering `ms`, so a clip stacked on top decides. */
function rangeAt(
  ranges: readonly MuteRange[],
  ms: number
): MuteRange | undefined {
  let found: MuteRange | undefined
  for (const range of ranges) {
    if (ms >= range.startMs && ms < range.endMs) found = range
  }
  return found
}

/** The keyframe clip whose mute applies at `ms`, if any claims it. */
export function mutingClipAt(
  clips: readonly AnimationClip[],
  ms: number
): AnimationClip | undefined {
  let found: AnimationClip | undefined
  for (const clip of clips) {
    if (clip.muted === undefined || clip.durationMs <= 0) continue
    if (ms >= clip.startMs && ms < clip.startMs + clip.durationMs) found = clip
  }
  return found
}

/** Whether the video's audio is silent at timeline time `ms`. */
export function mutedAt(
  ms: number,
  {
    animationClips,
    videoClips,
    mediaDurationMs,
    defaultMuted,
  }: {
    animationClips: readonly AnimationClip[]
    videoClips: readonly VideoTimelineClip[] | null | undefined
    mediaDurationMs?: number
    defaultMuted: boolean
  }
): boolean {
  const claimed = rangeAt(clipMuteRanges(animationClips), ms)
  if (claimed) return claimed.muted
  return videoClipAtTime(videoClips, ms, mediaDurationMs)?.muted ?? defaultMuted
}

/**
 * Re-cut audio segments so each piece has a single mute state.
 *
 * The export streams audio per segment, so a keyframe clip that mutes part of a
 * section has to become its own segment — splitting only changes where the
 * boundaries fall, never the source-to-timeline mapping, so picture and sound
 * stay in step.
 */
export function applyClipMuteToSegments(
  segments: readonly VideoSegment[],
  animationClips: readonly AnimationClip[]
): VideoSegment[] {
  const ranges = clipMuteRanges(animationClips)
  if (ranges.length === 0) return [...segments]

  const out: VideoSegment[] = []
  for (const segment of segments) {
    const lengthMs = segment.sourceEndMs - segment.sourceStartMs
    const startMs = segment.timelineStartMs
    const endMs = startMs + lengthMs
    if (lengthMs <= 0) continue

    const cuts = new Set<number>([startMs, endMs])
    for (const range of ranges) {
      if (range.startMs > startMs && range.startMs < endMs)
        cuts.add(range.startMs)
      if (range.endMs > startMs && range.endMs < endMs) cuts.add(range.endMs)
    }

    const points = [...cuts].sort((a, b) => a - b)
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i]
      const to = points[i + 1]
      if (to <= from) continue
      out.push({
        sourceStartMs: segment.sourceStartMs + (from - startMs),
        sourceEndMs: segment.sourceStartMs + (to - startMs),
        timelineStartMs: from,
        muted: rangeAt(ranges, (from + to) / 2)?.muted ?? segment.muted,
      })
    }
  }
  return out
}
