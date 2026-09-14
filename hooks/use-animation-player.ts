"use client"

import * as React from "react"

import { useEditorStore } from "@/lib/editor/store"
import type { AnimationClip } from "@/lib/editor/state-types"
import { mutedAt } from "@/lib/editor/audio-timeline"
import { getVideoMutedPreferenceSync } from "@/lib/editor/video-mute-preference"
import { sourceTimeAt, videoClipAtTime } from "@/lib/editor/video-timeline-map"
import { useVideoRegistry } from "@/lib/editor/video-registry"
import { createVideoSeeker, type VideoSeeker } from "@/lib/editor/video-seek"

type PlayerContextValue = {
  playheadMs: number
  durationMs: number
  isPlaying: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  reset: () => void
  seek: (ms: number) => void
}

const AnimationPlayerContext = React.createContext<PlayerContextValue | null>(
  null
)

/** Split out of the player context: the full value changes every frame while
 * playing, so components that only care whether playback is running (and would
 * otherwise re-render at 60fps) read this instead. */
const AnimationPlayingContext = React.createContext(false)

/** Stable identity so the clips selector can't loop the store subscription. */
const EMPTY_CLIPS: AnimationClip[] = []

/**
 * Owns playback state for Animate mode. Playhead + isPlaying live here (not in
 * the Zustand store) so scrubbing at 60fps doesn't flood undo history. The
 * timeline bar and the on-canvas animation layer both read from this context so
 * they stay in lock-step. When the base layer is a video, the same transport
 * drives the canvas <video> (via the registry the video control bar uses), so
 * play/pause/scrub move the actual footage.
 */
export function AnimationPlayerProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const durationMs = useEditorStore(
    (s) =>
      s.present.canvases.find((c) => c.id === s.present.activeCanvasId)
        ?.animation?.durationMs ?? 5000
  )
  const activeCanvasId = useEditorStore((s) => s.present.activeCanvasId)
  const videoClips = useEditorStore(
    (s) =>
      s.present.canvases.find((c) => c.id === s.present.activeCanvasId)
        ?.videoClips ?? null
  )
  const animationClips = useEditorStore(
    (s) =>
      s.present.canvases.find((c) => c.id === s.present.activeCanvasId)
        ?.animation?.clips ?? EMPTY_CLIPS
  )

  const [playheadMs, setPlayheadMs] = React.useState(0)
  const [isPlaying, setIsPlaying] = React.useState(false)

  const rafRef = React.useRef<number | null>(null)
  const startRef = React.useRef({ ts: 0, from: 0 })
  const durationRef = React.useRef(durationMs)
  React.useEffect(() => {
    durationRef.current = durationMs
  }, [durationMs])

  const isAnimateMode = useEditorStore((s) => s.isAnimateMode)
  const isAnimateModeRef = React.useRef(isAnimateMode)
  React.useEffect(() => {
    isAnimateModeRef.current = isAnimateMode
  }, [isAnimateMode])

  const activeCanvasIdRef = React.useRef(activeCanvasId)
  React.useEffect(() => {
    activeCanvasIdRef.current = activeCanvasId
  }, [activeCanvasId])

  const videoClipsRef = React.useRef(videoClips)
  React.useEffect(() => {
    videoClipsRef.current = videoClips
  }, [videoClips])

  const animationClipsRef = React.useRef(animationClips)
  React.useEffect(() => {
    animationClipsRef.current = animationClips
  }, [animationClips])

  /** The layered mute — keyframe clip first, then video section. */
  const mutedAtMs = React.useCallback(
    (ms: number, mediaDurationMs?: number) =>
      mutedAt(ms, {
        animationClips: isAnimateModeRef.current
          ? animationClipsRef.current
          : EMPTY_CLIPS,
        videoClips: videoClipsRef.current,
        mediaDurationMs,
        defaultMuted: getVideoMutedPreferenceSync(
          isAnimateModeRef.current ? "animate" : "present"
        ),
      }),
    []
  )

  const videoClipAt = React.useCallback(
    (ms: number, mediaDurationMs?: number) =>
      videoClipAtTime(videoClipsRef.current, ms, mediaDurationMs),
    []
  )

  const playheadRef = React.useRef(playheadMs)
  React.useEffect(() => {
    playheadRef.current = playheadMs
  }, [playheadMs])

  // The active canvas's <video> element, when its base layer is a video.
  const getVideo = React.useCallback(() => {
    const id = activeCanvasIdRef.current
    return id ? (useVideoRegistry.getState().videos[id] ?? null) : null
  }, [])

  // The registry parks a newly mounted <video> on the device mute preference,
  // which drops a per-section mute across a reload: the section's value is
  // persisted with the draft, but nothing applied it until playback started, so
  // the control bar (which reads the element) kept showing the wrong icon.
  // Re-apply it at rest, whenever the element or the track changes.
  React.useEffect(() => {
    let el: HTMLVideoElement | null = null
    const apply = () => {
      if (!el) return
      const mediaDurationMs = Number.isFinite(el.duration)
        ? el.duration * 1000
        : undefined
      el.muted = mutedAtMs(playheadRef.current, mediaDurationMs)
    }
    const attach = () => {
      const next = getVideo()
      if (next === el) return
      el?.removeEventListener("loadedmetadata", apply)
      el = next
      el?.addEventListener("loadedmetadata", apply)
      apply()
    }
    attach()
    const unsubscribe = useVideoRegistry.subscribe(attach)
    return () => {
      unsubscribe()
      el?.removeEventListener("loadedmetadata", apply)
    }
  }, [
    activeCanvasId,
    isAnimateMode,
    videoClips,
    animationClips,
    getVideo,
    mutedAtMs,
  ])

  // Lazy: the provider re-renders every frame while playing, and an eager
  // `useRef(createVideoSeeker())` would build a seeker per frame to discard it.
  const seekerRef = React.useRef<VideoSeeker | null>(null)
  const getSeeker = React.useCallback(() => {
    seekerRef.current ??= createVideoSeeker()
    return seekerRef.current
  }, [])

  /**
   * Park the canvas video on timeline time `ms`. Scrubbing leaves `immediate`
   * off so a drag can't outrun the decoder; anything that is about to play from
   * this position needs it on, or playback starts from wherever the last scrub
   * seek happened to be.
   */
  const syncVideoTo = React.useCallback(
    (ms: number, immediate = false) => {
      const el = getVideo()
      if (!el) return
      const duration = Number.isFinite(el.duration) ? el.duration : undefined
      const clip = videoClipAt(
        ms,
        duration != null ? duration * 1000 : undefined
      )
      if (!clip) return
      el.muted = mutedAtMs(ms, duration != null ? duration * 1000 : undefined)
      const seconds = sourceTimeAt(videoClipsRef.current, ms, duration)
      if (seconds == null) return
      const seeker = getSeeker()
      if (immediate) seeker.seekNow(el, seconds)
      else seeker.seek(el, seconds)
    },
    [getVideo, videoClipAt, getSeeker, mutedAtMs]
  )

  const stopRaf = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const pause = React.useCallback(() => {
    stopRaf()
    setIsPlaying(false)
    getVideo()?.pause()
  }, [stopRaf, getVideo])

  const play = React.useCallback(() => {
    const total = durationRef.current
    // Restart from 0 when parked at (or past) the end.
    const from = playheadMs >= total ? 0 : playheadMs
    startRef.current = { ts: performance.now(), from }
    setIsPlaying(true)

    const video = getVideo()
    if (video) {
      syncVideoTo(from, true)
      if (
        videoClipAt(
          from,
          Number.isFinite(video.duration) ? video.duration * 1000 : undefined
        )
      ) {
        void video.play().catch(() => {})
      } else {
        video.pause()
      }
    }

    const tick = (now: number) => {
      const elapsed = now - startRef.current.ts
      const next = startRef.current.from + elapsed
      const activeVideo = getVideo()
      if (activeVideo) {
        const activeClip = videoClipAt(
          next,
          Number.isFinite(activeVideo.duration)
            ? activeVideo.duration * 1000
            : undefined
        )
        if (!activeClip) {
          activeVideo.pause()
        } else if (activeVideo.paused) {
          syncVideoTo(next, true)
          void activeVideo.play().catch(() => {})
        } else {
          activeVideo.muted = mutedAtMs(
            next,
            Number.isFinite(activeVideo.duration)
              ? activeVideo.duration * 1000
              : undefined
          )
        }
      }
      if (next >= total) {
        setPlayheadMs(total)
        stopRaf()
        setIsPlaying(false)
        getVideo()?.pause()
        return
      }
      setPlayheadMs(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [playheadMs, stopRaf, getVideo, syncVideoTo, videoClipAt, mutedAtMs])

  const toggle = React.useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, pause, play])

  const seek = React.useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, durationRef.current))
      setPlayheadMs(clamped)
      syncVideoTo(clamped)
      if (isPlaying) startRef.current = { ts: performance.now(), from: clamped }
    },
    [isPlaying, syncVideoTo]
  )

  const reset = React.useCallback(() => {
    pause()
    setPlayheadMs(0)
    syncVideoTo(0, true)
  }, [pause, syncVideoTo])

  React.useEffect(() => {
    return () => {
      stopRaf()
      seekerRef.current?.dispose()
    }
  }, [stopRaf])

  const value = React.useMemo<PlayerContextValue>(
    () => ({
      playheadMs,
      durationMs,
      isPlaying,
      play,
      pause,
      toggle,
      reset,
      seek,
    }),
    [playheadMs, durationMs, isPlaying, play, pause, toggle, reset, seek]
  )

  return React.createElement(
    AnimationPlayerContext.Provider,
    { value },
    React.createElement(
      AnimationPlayingContext.Provider,
      { value: isPlaying },
      children
    )
  )
}

export function useAnimationPlayer(): PlayerContextValue {
  const ctx = React.useContext(AnimationPlayerContext)
  if (!ctx) {
    throw new Error(
      "useAnimationPlayer must be used within an AnimationPlayerProvider"
    )
  }
  return ctx
}

/** Non-throwing variant for components that render both in and out of animate mode. */
export function useAnimationPlayerOptional(): PlayerContextValue | null {
  return React.useContext(AnimationPlayerContext)
}

/** Whether animation playback is running. False outside the provider. */
export function useAnimationIsPlaying(): boolean {
  return React.useContext(AnimationPlayingContext)
}
