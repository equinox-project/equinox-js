module type Decider = {
  type event
  type state
  let initial: state
  let fold: (state, array<event>) => state
}

type scenario_state<'e, 's> = {
  name: string,
  events: array<'e>,
  decide?: 's => array<'e>,
}

module Make = (Decider: Decider) => {
  open Vitest
  @inline
  let scenario = name => {name, events: []}

  @inline
  let given = (scenario, events) => {
    ...scenario,
    name: scenario.name,
    events: Belt.Array.concat(scenario.events, events),
  }

  @inline
  let when_ = (scenario, decide) => {
    ...scenario,
    decide,
  }

  @inline
  let run = scenario => {
    let state = Decider.fold(Decider.initial, scenario.events)
    let decide = scenario.decide->Belt.Option.getExn
    decide(state)
  }

  @inline
  let then = (scenario, events: array<Decider.event>) => {
    test(scenario.name, () => {
      Expect.toEqual(scenario->run, events)
    })
  }

  @inline
  let thenError = scenario => {
    test(scenario.name, () => {
      Expect.toThrowAny(() => scenario->run)
    })
  }
}

// export function createTester<Event, State>({
//   fold,
//   initial,
// }: {
//   fold: (state: State, events: Event[]) => State
//   initial: State
// }) {
//   const scenario = (
//     title: string,
//     { state, events, error }: ScenarioState<Event, State> = { state: initial, events: [] },
//   ) => ({
//     given(events: Event[]) {
//       return scenario(title, { state: fold(state, events), events })
//     },
//     when(decision: (state: State) => Event[]) {
//       try {
//         return this.given(decision(state))
//       } catch (error) {
//         return scenario(title, { state, events, error })
//       }
//     },
//     then(check: (scenario: ScenarioState<Event, State>) => void) {
//       test(title, () => check({ state, events, error }))
//     },
//   })
//
//   return { scenario }
// }
//
// export const expectEventsMatching =
//   (specs: unknown[]) =>
//   ({ events, error }: ScenarioState<any, any>) => {
//     expect(error).toBeUndefined()
//     expect(events).toEqual(specs.map(expect.objectContaining))
//   }
//
// export const expectNoEvents = ({ events, error }: ScenarioState<any, any>) => {
//   expect(error).toBeUndefined()
//   expect(events).toEqual([])
// }
//
// export const expectError = ({ error }: ScenarioState<any, any>) => expect(error).toBeDefined()
