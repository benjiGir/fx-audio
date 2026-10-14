// Bundle-size reference: the cheapest possible Effect program.
import * as Effect from "effect/Effect"
export const run = (): Promise<number> => Effect.runPromise(Effect.succeed(1))
