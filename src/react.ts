/**
 * React bindings: one provider that owns the audio, and hooks to reach it.
 * @module fx-audio/react
 */

import type { ReactNode } from "react"
import { createContext, createElement, useContext, useEffect, useState } from "react"
import type { AudioContextService } from "./context.ts"
import type * as Layer from "effect/Layer"
import type { Sound } from "./model.ts"
import type { PromiseAudio, PromiseGroup, PromiseVoice } from "./promise.ts"
import { createAudio } from "./promise.ts"

const AudioReact = createContext<PromiseAudio | undefined>(undefined)

/** Props of {@link AudioProvider}. */
export interface AudioProviderProps {
  readonly children?: ReactNode
  /** Shown until the audio exists, that is, on the server and during the first render in the browser. */
  readonly fallback?: ReactNode
  /** Platform layer, the browser audio context by default. */
  readonly platform?: Layer.Layer<AudioContextService>
  /** Use this audio instead of creating one. The provider then leaves it alone: you dispose it. */
  readonly audio?: PromiseAudio
}

/**
 * Make an audio available to the components below. Unless you pass `audio`, it creates one after the first
 * render (so it is safe on the server) and disposes it when the provider unmounts.
 *
 * @example
 * ```tsx
 * <AudioProvider>
 *   <Game />
 * </AudioProvider>
 * ```
 */
export const AudioProvider = (props: AudioProviderProps): ReactNode => {
  const { audio: given, platform, fallback, children } = props
  const [owned, setOwned] = useState<PromiseAudio | undefined>(undefined)
  useEffect(() => {
    if (given !== undefined) return
    const created = createAudio(platform)
    setOwned(created)
    return () => {
      setOwned(undefined)
      void created.dispose()
    }
  }, [given, platform])
  const audio = given ?? owned
  return audio === undefined
    ? (fallback ?? null)
    : createElement(AudioReact.Provider, { value: audio }, children)
}

/** The audio of the nearest {@link AudioProvider}. Throws outside one. */
export const useAudio = (): PromiseAudio => {
  const audio = useContext(AudioReact)
  if (audio === undefined) throw new Error("useAudio must be used inside an <AudioProvider>")
  return audio
}

/** The group called `name` (the same object on every render), created on first use. */
export const useGroup = (name: string): PromiseGroup => useAudio().group(name)

/** What {@link useSound} gives back. */
export type SoundState = {
  /** The decoded sound once loaded. */
  readonly sound: Sound | undefined
  /** Why loading failed, if it did. */
  readonly error: unknown
  readonly status: "loading" | "ready" | "error"
  /** Play the sound. Does nothing, and returns `undefined`, until it is loaded. */
  readonly play: (options?: unknown) => PromiseVoice | undefined
}

/**
 * Load `url` and give back the sound with a `play` function. Loading restarts when `url` changes and is
 * cancelled when the component unmounts.
 *
 * @example
 * ```tsx
 * const hit = useSound("/sounds/hit.mp3")
 * return <button onClick={() => hit.play({ volume: 0.8 })}>Hit</button>
 * ```
 */
export const useSound = (url: string): SoundState => {
  const audio = useAudio()
  type Loaded = { readonly url: string; readonly sound: Sound }
  type Failed = { readonly url: string; readonly error: unknown }
  const [result, setResult] = useState<Loaded | Failed | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    audio
      .load(url, controller.signal)
      .then(
        (sound): Loaded => ({ url, sound }),
        (error: unknown): Failed => ({ url, error })
      )
      .then((next) => {
        if (!controller.signal.aborted) setResult(next)
      })
    return () => controller.abort()
  }, [audio, url])
  const current = result?.url === url ? result : undefined
  const sound = current !== undefined && "sound" in current ? current.sound : undefined
  const error = current !== undefined && "error" in current ? current.error : undefined
  return {
    sound,
    error,
    status: sound !== undefined ? "ready" : current !== undefined ? "error" : "loading",
    play: (options) => (sound === undefined ? undefined : audio.play(sound, options))
  }
}
