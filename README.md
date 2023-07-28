# Equinox JS

This is a JS port of jet's [Equinox](https://github.com/jet/equinox).

Equinox is a set of low dependency libraries that allow for event-sourced processing against stream-based stores handling:

- Snapshots
- Caching
- [Optimistic concurrency control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control)

## Resources

- [Documentation](https://nordfjord.github.io/equinox-js/docs/intro)
- [jet/equinox](https://github.com/jet/equinox)
- [The-Inevitable-Event-Centric-Book](https://github.com/ylorph/The-Inevitable-Event-Centric-Book/issues)

## Contributing

First clone this repository and enter the directory

```sh
$ docker-compose up -d # starts message-db
$ pnpm install
$ pnpm build
$ pnpm test
```

# Notable differences from Equinox

### TypeScript doesn't have DU's

Well, that's technically not true, we can approximate them as such:

```typescript
type Data = { hello: "world" }
type Event = { type: "Something"; data: Data }
```

### TypeScript doesn't have modules

We can replace them with namespaces, but people will look at you funny for using them
for some reason 🤷.

```typescript
export namespace Events {
  type Data = { hello: "world" }
  export type Event = { type: "Something"; data: Data }
}
```
