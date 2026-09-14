"use client"

import * as React from "react"

type TimelineWaveformProps = {
  /** Peaks 0–1 across the whole video source. */
  peaks: number[]
  /** How many buckets the finished waveform has (peaks may still be filling). */
  bucketCount: number
  /** Source range this clip plays, in ms. */
  startMs: number
  endMs: number
  durationMs: number
  muted?: boolean
  /**
   * Windows of this clip a keyframe clip has claimed, as fractions 0–1 across
   * the clip's width. They override `muted` for exactly their span, so a clip
   * muted for one keyframe reads as muted there and audible either side.
   */
  mutedBands?: { fromFrac: number; toFrac: number; muted: boolean }[]
}

const MUTED_OPACITY = 0.35

// Points across the clip width; the SVG stretches them, so this is about curve
// smoothness, not pixel resolution.
const SAMPLES = 96
// The theme's matcha accent, fixed rather than themed: the band behind it is
// always dark, so the light-mode accent would be too deep to read.
const MATCHA = "oklch(0.84 0.15 145)"

export function TimelineWaveform({
  peaks,
  bucketCount,
  startMs,
  endMs,
  durationMs,
  muted,
  mutedBands,
}: TimelineWaveformProps) {
  const path = React.useMemo(() => {
    if (peaks.length === 0 || bucketCount === 0 || durationMs <= 0) return null
    const startFrac = Math.max(0, Math.min(1, startMs / durationMs))
    const endFrac = Math.max(startFrac, Math.min(1, endMs / durationMs))
    const points: string[] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const frac = startFrac + ((endFrac - startFrac) * i) / SAMPLES
      const idx = Math.min(peaks.length - 1, Math.floor(frac * bucketCount))
      // Bottom-anchored: y runs 1 (baseline) up to 0 (full amplitude).
      const y = 1 - Math.max(0.02, peaks[idx] ?? 0)
      points.push(`${(i / SAMPLES) * 100},${y.toFixed(4)}`)
    }
    return `M0,1 L${points.join(" L")} L100,1 Z`
  }, [peaks, bucketCount, startMs, endMs, durationMs])

  const uid = React.useId().replace(/:/g, "")
  const gradientId = `wf${uid}`

  // One band per span of constant mute state, so a single path can be drawn
  // repeatedly through clip rects instead of resampling the peaks per span.
  const bands = React.useMemo(() => {
    const base = muted ?? false
    const claims = (mutedBands ?? [])
      .map((band) => ({
        fromFrac: Math.max(0, Math.min(1, band.fromFrac)),
        toFrac: Math.max(0, Math.min(1, band.toFrac)),
        muted: band.muted,
      }))
      .filter((band) => band.toFrac > band.fromFrac)
    if (claims.length === 0) return [{ fromFrac: 0, toFrac: 1, muted: base }]

    const edges = new Set<number>([0, 1])
    for (const band of claims) {
      edges.add(band.fromFrac)
      edges.add(band.toFrac)
    }
    const points = [...edges].sort((a, b) => a - b)
    const out: { fromFrac: number; toFrac: number; muted: boolean }[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const fromFrac = points[i]
      const toFrac = points[i + 1]
      const mid = (fromFrac + toFrac) / 2
      let value = base
      for (const band of claims) {
        if (mid >= band.fromFrac && mid < band.toFrac) value = band.muted
      }
      out.push({ fromFrac, toFrac, muted: value })
    }
    return out
  }, [muted, mutedBands])

  if (!path) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[60%] bg-linear-to-t from-black/65 via-black/35 to-transparent"
    >
      <svg viewBox="0 0 100 1" preserveAspectRatio="none" className="size-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={MATCHA} stopOpacity="0.85" />
            <stop offset="100%" stopColor={MATCHA} stopOpacity="0.4" />
          </linearGradient>
          {bands.map((band, i) => (
            <clipPath key={i} id={`${uid}b${i}`}>
              <rect
                x={band.fromFrac * 100}
                y={0}
                width={(band.toFrac - band.fromFrac) * 100}
                height={1}
              />
            </clipPath>
          ))}
        </defs>
        {bands.map((band, i) => (
          <path
            key={i}
            d={path}
            fill={`url(#${gradientId})`}
            clipPath={`url(#${uid}b${i})`}
            opacity={band.muted ? MUTED_OPACITY : 1}
          />
        ))}
      </svg>
    </div>
  )
}
