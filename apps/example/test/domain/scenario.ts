import { expect, test } from "vitest"

type ScenarioState<Event, State> = {
  state: State
  events: Event[]
  error?: unknown
}

export function createBDD<Event, State>(
  fold: (state: State, events: Event[]) => State,
  initial: State,
) {
  const scenario = (
    title: string,
    { state, events, error }: ScenarioState<Event, State> = { state: initial, events: [] },
  ) => ({
    given(events: Event[]) {
      return scenario(title, { state: fold(state, events), events })
    },
    when(decision: (state: State) => Event[]) {
      try {
        return this.given(decision(state))
      } catch (error) {
        return scenario(title, { state, events, error })
      }
    },
    then(check: (scenario: ScenarioState<Event, State>) => void) {
      test(title, () => check({ state, events, error }))
    },
  })

  return { scenario }
}

export const expectEventsMatching =
  (specs: unknown[]) =>
  ({ events, error }: ScenarioState<any, any>) => {
    expect(error).toBeUndefined()
    expect(events).toEqual(specs.map(expect.objectContaining))
  }

export const expectNoEvents = ({ events, error }: ScenarioState<any, any>) => {
  expect(error).toBeUndefined()
  expect(events).toEqual([])
}

export const expectError = ({ error }: ScenarioState<any, any>) => expect(error).toBeDefined()
