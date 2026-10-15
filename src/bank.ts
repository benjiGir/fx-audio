import type { Sound } from "./model.ts"

/** A set of sounds to pick from, so that a sound that plays often does not sound the same every time. */
export interface SoundBank {
  /** How many sounds the bank holds. */
  readonly size: number
  /** The next sound to play. In `random` order it is never the one that came before, unless there is only one. */
  next(): Sound
}

/**
 * Pick from `sounds` in `random` order (the default, never the same sound twice in a row) or in `cycle`
 * order, one after the other and round again. Throws a `RangeError` on an empty list.
 *
 * @example
 * ```ts
 * const steps = makeSoundBank([step1, step2, step3])
 * yield* audio.play(steps.next(), { rateVariation: 0.1 })
 * ```
 */
export const makeSoundBank = (
  sounds: ReadonlyArray<Sound>,
  options: { readonly order?: "random" | "cycle" } = {}
): SoundBank => {
  if (sounds.length === 0) throw new RangeError("a sound bank needs at least one sound")
  const list = [...sounds]
  const count = list.length
  let last = -1
  const choose = () => {
    if (options.order === "cycle") return (last + 1) % count
    if (count === 1) return 0
    if (last < 0) return Math.floor(Math.random() * count)
    // One of the others: skip over the index that played last.
    const pick = Math.floor(Math.random() * (count - 1))
    return pick >= last ? pick + 1 : pick
  }
  return {
    size: count,
    next: () => {
      last = choose()
      return list[last] as Sound
    }
  }
}
