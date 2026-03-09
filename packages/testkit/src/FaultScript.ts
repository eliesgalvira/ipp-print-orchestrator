import { Effect, Ref } from "effect"

export interface FaultScript<A> {
  readonly next: Effect.Effect<A>
}

export const makeFaultScript = <A>(
  steps: readonly [A, ...readonly A[]],
): Effect.Effect<FaultScript<A>> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(0)

    const next = Ref.modify(ref, (index) => {
      const boundedIndex = Math.min(index, steps.length - 1)
      const value = steps[boundedIndex]!
      const nextIndex = Math.min(index + 1, steps.length - 1)
      return [value, nextIndex] as const
    })

    return { next }
  })
