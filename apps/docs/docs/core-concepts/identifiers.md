# Identifiers

EquinoxJS exposes a helper module for dealing with branded UUIDs.

```ts
import { Uuid } from "@equinox-js/core"

export type UserId = Uuid.Uuid<"UserId">
export const UserId = Uuid.create<"UserId">()
```

the `Uuid.create` function returns an object with some utilities

```ts
import { UserId } from "./identifiers"
let userId = UserId.create() 
// userId = "3810367d-19f1-479e-aad3-bf6e5d1d9d98"
// will lowercase any supplied UUID
UserId.parse("186FDAEE-54D8-45E7-BDFC-9B17E527883E")
// "186fdaee-54d8-45e7-bdfc-9b17e527883e"
UserId.toString(userId)
// "3810367d-19f1-479e-aad3-bf6e5d1d9d98"
```
