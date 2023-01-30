# Equinox JS

This is a JS port of jet's [Equinox](https://github.com/jet/equinox).

Equinox is a set of low dependency libraries that allow for event-sourced processing against stream-based stores handling:
* Snapshots
* Caching
* [Optimistic concurrency control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control)

Reading the Equinox documentation and related materials is considered a requirement to use this library.

# Running the sample

First clone this repository and enter the directory

```sh
$ pnpm i
$ pnpm exec turbo build
$ docker-compose up -d
$ cd ./packages/dynamo-store-tf
$ terraform init
$ terraform apply
$ cd ../../apps/sample
$ pnpm dev
```

# Differences from Equinox

### TypeScript doesn't have DU's
Well, that's technically not true, we can approximate them as such:

```typescript
type Data = {hello: 'world'}
type Event = {type: 'Something', data: Data}
```

### TypeScript doesn't have modules

We can replace them with namespaces, but people will look at you funny for using them
for some reason 🤷.

```typescript
export namespace Events {
  type Data = {hello: 'world'}
  export type Event = {type: 'Something', data: Data}
}
```

### Codecs

Because we represent DU's with a `{type, data}` object there's no
need for a bespoke codec solution. We can just `JSON.stringify(data)`
and be done with it.

Of course, in some cases you'll need to encode/decode so we do provide
a way to achieve this.

```typescript
const codec: Codec<Event> = {
  tryDecode(event: TimelineEvent<Record<string, any>>) : Event | undefined {
    switch (event.type) {
      case 'MyEvent': 
        return {type: event.type, data: {...event.data, timestamp: new Date(event.data.timestamp)}}
    }
  },
  encode(event: Event) {
    switch (event.type) {
      case 'MyEvent': 
        return {
          type: event.type, 
          data: {
            ...event.data, 
            timestamp: event.data.timestamp.toISOString()
          }
        }
    }
  }
}
```

DynamoStore needs some extra processing, so we provide `AsyncCodec.deflate` for this purpose.
It'll stringify your body and then attempt to compress it. It'll choose the smaller
of the compressed or the uncompressed bodies.

### Logging

Equinox is quite heavily coupled to Serilog. There is no Serilog equivalent in
JS. Even if there were, we'd likely not use it anyway. In this 
library we provide OpenTelemetry out of the box.
