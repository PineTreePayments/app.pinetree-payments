declare module "bs58" {
  export function encode(source: Uint8Array | Buffer | readonly number[]): string
  export function decode(source: string): Buffer
}
