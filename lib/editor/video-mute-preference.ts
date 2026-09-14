/**
 * Editor video mute preference (localStorage only).
 *
 * Default is muted for browser autoplay policy. Toggle remembers across reloads
 * on this device — no account/DB sync needed.
 */

export const VIDEO_MUTED_STORAGE_KEY = "tokokino:video-muted"
export const DEFAULT_VIDEO_MUTED = true

/**
 * Animate mode and Present mode keep separate mute preferences. Animate is an
 * editing surface where you scrub with the sound on; Present is playback. One
 * shared key meant muting in either silenced the other, which is not what the
 * toggle in front of you appears to do.
 */
export type VideoMuteScope = "present" | "animate"

const STORAGE_KEY: Record<VideoMuteScope, string> = {
  present: VIDEO_MUTED_STORAGE_KEY,
  animate: `${VIDEO_MUTED_STORAGE_KEY}:animate`,
}

function readStored(scope: VideoMuteScope): boolean | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY[scope])
    if (raw === "1" || raw === "true") return true
    if (raw === "0" || raw === "false") return false
  } catch {
    /* private mode / blocked storage */
  }
  return null
}

/** Sync read — prefers localStorage, else muted default. */
export function getVideoMutedPreferenceSync(
  scope: VideoMuteScope = "present"
): boolean {
  return readStored(scope) ?? DEFAULT_VIDEO_MUTED
}

export function setVideoMutedPreference(
  muted: boolean,
  scope: VideoMuteScope = "present"
): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY[scope], muted ? "1" : "0")
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/**
 * A track section's effective mute: its own value when it has one, else the
 * device preference. Per-section mute is an override, so every reader — the
 * player, the control bar, the element at rest — has to resolve it the same way
 * or they disagree about whether the video is muted.
 */
export function resolveVideoMuted(
  clip: { muted?: boolean } | null | undefined,
  fallback: boolean = getVideoMutedPreferenceSync("animate")
): boolean {
  return clip?.muted ?? fallback
}

/** Apply mute preference to every registered video element. */
export function applyVideoMutedToAll(
  videos: Record<string, HTMLVideoElement>,
  muted = getVideoMutedPreferenceSync("present")
) {
  for (const el of Object.values(videos)) {
    el.muted = muted
  }
}
