---
sidebar_position: 3
---

# Anatomy of an Equinox Service

An Equinox service is composed of a few modules (namespaces).

- **Stream**: shows which category the service writes to and how the identity
  of the stream is composed (and the reverse operations for when running Reaction logic)
- **Events**: shows which events the service writes
- **Fold**: shows how the events are folded into state
- **Decide**: shows which actions can be taken upon the state (resulting in
  new events being written)
- **Query**: shows how we map the state to answer questions.
- **Service**: the class that wraps the above into a cohesive domain service.
- **Config**: shows how we've opted to to bind the Service to Streams in a Concrete Store (which Access Strategies to apply, if any)
  including important information like access strategies.

:::tip

Everything above `Service` is considered internal to the module. It is exported
as a convenience for testing, but other modules should not take a dependency on
anything other than the `Service`.

:::

Let's see what each of these modules looks like for a simple service for
checking in and out for an Appointment Booking.

## The Stream

```ts
export namespace Stream {
  export const category = "AppointmentActuals"
  export const streamId = StreamId.gen(AppointmentId.toString, UserId.toString)
  export const decodeId = StreamId.dec(AppointmentId.parse, UserId.parse)
  export const tryMatch = StreamName.tryMatch(category, decodeId)
}
```

## The Events

```ts
export namespace Events {
  // prettier-ignore
  const date = z.string().datetime().transform((x) => new Date(x))
  export const Timestamp = z.object({ timestamp: date })
  export const ActualsOverridden = z.object({ checkedIn: date, checkedOut: date })
  export type ActualsOverridden = z.infer<typeof ActualsOverridden>

  export type Event =
    | { type: "CheckedIn"; data: Timestamp }
    | { type: "CheckedOut"; data: Timestamp }
    | { type: "ActualsOverridden"; data: ActualsOverridden }

  export const codec = Codec.upcast<Event>(
    Codec.json(),
    Codec.Upcast.from({
      CheckedIn: Timstamp.parse,
      CheckedOut: Timstamp.parse,
      ActualsOverridden: ActualsOverridden.parse,
    }),
  )
}
```

## The Fold

```ts
export namespace Fold {
  import Event = Events.Event
  export type State = { checkedIn?: Date; checkedOut?: Date }
  export const initial: State = {}
  export const evolve = (state: State, event: Event) => {
    switch (event.type) {
      case "CheckedIn":
        return { ...state, checkedIn: event.data.timestamp }
      case "CheckedOut":
        return { ...state, checkedOut: event.data.timestamp }
      case "ActualsOverridden":
        return event.data
    }
  }
}
```

## The Decide

```ts
export namespace Decide {
  import Event = Events.Event
  import State = Fold.State
  export const checkIn =
    (timestamp: Date) =>
    (state: State): Event[] => {
      // Check if already checked in with a different timestamp
      // The caller is expected to guard against this
      if (state.checkedIn && +state.checkedIn !== +timestamp) {
        throw new Error("Already checked in with different timestamp")
      }

      // Silent idempotent handling: We accept retried requests with identical timestamps.
      // If checked in with the same timestamp, no changes are required.
      if (state.checkedIn && +state.checkedIn === +timestamp) return []

      return [{ type: "CheckedIn", data: { timestamp } }]
    }
  export const checkOut =
    (timestamp: Date) =>
    (state: State): Event[] => {
      if (state.checkedOut && +state.checkedOut !== +timestamp) {
        throw new Error("Already checked out with different timestamp")
      }
      if (state.checkedOut && +state.checkedOut === +timestamp) return []
      return [{ type: "CheckedOut", data: { timestamp } }]
    }

  export const manuallyOverride = (checkedIn: Date, checkedOut: Date) => (state: State) => {
    if (+checkedIn === +state?.checkedIn && +checkedOut === +state?.checkedIn) return []
    return [{ type: "ActualsOverridden", data: { checkedIn, checkedOut } }]
  }
}
```

## The Queries

```ts
export namespace Query {
  type Status =
    | { type: "not-started"; version: bigint }
    | { type: "in-progress"; version: bigint; startedAt: Date }
    | { type: "complete"; version: bigint; startedAt: Date; durationMs: number }
  export const status = ({ state, version }: ISyncContext<Fold.State>): Status => {
    if (state.checkedIn && state.checkedOut) {
      return {
        type: "complete",
        version,
        startedAt: state.checkedIn,
        durationMs: +state.checkedOut - +state.checkedIn,
      }
    }
    if (state.checkedIn) return { type: "in-progress", version, startedAt: state.checkedIn }
    return { type: "not-started", version }
  }
}
```

## The Service

```ts
export class Service {
  constructor(
    private readonly resolve: (
      appointmentId: AppointmentId,
      userId: UserId,
    ) => Decider<Events.Event, Fold.State>,
  ) {}

  checkIn(appointmentId: AppointmentId, userId: UserId, timestamp: Date) {
    const decider = this.resolve(appointmentId, userId)
    return decider.transact(Decide.checkIn(timestamp), LoadOption.AssumeEmpty)
  }

  checkOut(appointmentId: AppointmentId, userId: UserId, timestamp: Date) {
    const decider = this.resolve(appointmentId, userId)
    return decider.transact(Decide.checkOut(timestamp))
  }

  manuallyOverride(
    appointmentId: AppointmentId,
    userId: UserId,
    checkedIn: Date,
    checkedOut: Date,
  ) {
    const decider = this.resolve(appointmentId, userId)
    return decider.transact(Decide.manuallyOverride(checkedIn, checkedOut))
  }

  readStatus(appointmentId: AppointmentId, userId: UserId) {
    const decider = this.resolve(appointmentId, userId)
    decider.queryEx(Query.status)
  }

  /** In many cases we do not need to fetch missing events because we can accept a stale value from the cache.
   *  We prefer making the staleness explicit in the method name */
  readStatusStale(appointmentId: AppointmentId, userId: UserId) {
    const decider = this.resolve(appointmentId, userId)
    decider.queryEx(Query.status, LoadOption.AnyCachedValue)
  }
}
```

## The Config

<details>
<summary>See the `../equinox-config.ts` snippet</summary>

Most projects will be well served by copying this snippet and removing stores
that are not in use. That is, have a binding for memory store and a single
concrete store.

```ts
import { ICodec, ICache, CachingStrategy, Codec } from "@equinox-js/core"
import { MemoryStoreCategory, VolatileStore } from "@equinox-js/memory-store"
import * as MessageDB from "@equinox-js/message-db"
import * as DynamoDB from "@equinox-js/dynamo-store"

export enum Store {
  Memory,
  MessageDb,
  Dynamo,
}

export type Config =
  | { store: Store.Memory; context: VolatileStore<string> }
  | { store: Store.MessageDb; context: MessageDB.MessageDbContext; cache: ICache }
  | { store: Store.Dynamo; context: DynamoDB.DynamoStoreContext; cache: ICache }

// prettier-ignore
export namespace MessageDb {
  import AccessStrategy = MessageDB.AccessStrategy
  import Category = MessageDB.MessageDbCategory
  import Context = MessageDB.MessageDbContext
  type Config = { context: Context; cache: ICache }

  export function createCached<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, access: AccessStrategy<E, S>, { context, cache }: Config) {
    const caching = CachingStrategy.Cache(cache)
    return Category.create(context, name, codec, fold, initial, caching, access);
  }
  export function createUnoptimized<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: Config) {
    const access = AccessStrategy.Unoptimized<E, S>()
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  }
  export function createSnapshotted<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, eventName: string, toSnapshot: (s: S) => E, config: Config) {
    const access = AccessStrategy.AdjacentSnapshots(eventName, toSnapshot)
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  }
  export function createLatestKnown<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: Config) {
    const access = AccessStrategy.LatestKnownEvent<E, S>()
    return MessageDb.createCached(name, codec, fold, initial, access, config)
  }
}

// prettier-ignore
export namespace Dynamo {
  import AccessStrategy = DynamoDB.AccessStrategy
  import Category = DynamoDB.DynamoStoreCategory
  import Context = DynamoDB.DynamoStoreContext
  type Config = { context: Context; cache: ICache }
  export function createCached<E, S, C>(name: string, codec_: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, access: AccessStrategy<E, S>, { context, cache }: Config) {
    const caching = CachingStrategy.Cache(cache)
    const codec = Codec.compress(codec_)
    return Category.create(context, name, codec, fold, initial, caching, access);
  }
  export function createUnoptimized<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: Config) {
    const access = AccessStrategy.Unoptimized()
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
  export function createSnapshotted<E,S,C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, isOrigin: (e: E) => boolean, toSnapshot: (s: S) => E, config: Config) {
    const access = AccessStrategy.Snapshot(isOrigin, toSnapshot)
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
  export function createRollingState<E,S,C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, toSnapshot: (s: S) => E, config: Config) {
    const access = AccessStrategy.RollingState(toSnapshot)
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
  export function createLatestKnown<E,S,C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, config: Config) {
    const access = AccessStrategy.LatestKnownEvent()
    return Dynamo.createCached(name, codec, fold, initial, access, config)
  }
}

// prettier-ignore
export namespace MemoryStore {
  export function create<E, S, C>(name: string, codec: ICodec<E, string, C>, fold: (s: S, e: E[]) => S, initial: S, { context: store }: { context: VolatileStore<string> }) {
    return MemoryStoreCategory.create(store, name, codec, fold, initial)
  }
}
```

</details>

```ts
import * as Config from "../equinox-config"
class Service {
  // ... as above

  // prettier-ignore
  static resolveCategory(config: Config.Config) {
    switch (config.store) {
      case Config.Store.Memory:
        return Config.MemoryStore.create(Stream.category, Events.codec, Fold.fold, Fold.initial, config)
      case Config.Store.MessageDB:
        return Config.MessageDB.createUnoptimized(Stream.category, Events.codec, Fold.fold, Fold.initial, config)
      case Config.Store.Dynamo:
        return Config.Dynamo.createUnoptimized(Stream.category, Events.codec, Fold.fold, Fold.initial, config)
    }
  }
  static create(config: Config.Config) {
    const category = Service.resolveCategory(config)
    const resolve = (appointmentId: AppointmentId, userId: UserId) =>
      Decider.forStream(category, Stream.streamId(appointmentId, userId), null)
    return new Service(resolve)
  }
}
```
