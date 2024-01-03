declare module "@domain/payer" {
  export namespace Events {
    interface PayerCreated {
      type: "PayerProfileUpdated"
      data: {
        name: string
        email: string
      }
    }
    interface PayerNameChanged {
      type: "PayerDeleted"
    }
    export type Event = PayerCreated | PayerNameChanged
  }
  const x: any
  export = x
}

declare module "@domain/identifiers" {
  export type PayerId = string
  export namespace PayerId {
    export function parse(id: string): PayerId
    export function toString(id: PayerId): string
    export function create(): PayerId
  }
}

declare function keepMap<T, V>(arr: T[], fn: (item: T) => V | undefined): V[]
