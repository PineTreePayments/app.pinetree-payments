import { PineTreeBrowserClient } from "./client"
import { CheckoutResource } from "./checkout"
import type { PineTreeJSOptions } from "./types"

export class PineTree {
  readonly checkout: CheckoutResource

  constructor(publicKeyOrOptions: string | PineTreeJSOptions) {
    const client = new PineTreeBrowserClient(publicKeyOrOptions)
    this.checkout = new CheckoutResource(client)
  }
}

export default PineTree

export * from "./errors"
export * from "./types"
