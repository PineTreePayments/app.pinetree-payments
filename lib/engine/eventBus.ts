type EventHandler = (payload: any) => Promise<void> | void

const handlers: Record<string, EventHandler[]> = {}

export function onEvent(event: string, handler: EventHandler) {
  if (!handlers[event]) {
    handlers[event] = []
  }

  handlers[event].push(handler)
}

export async function emitEvent(event: string, payload: any) {

  const eventHandlers = handlers[event]

  if (!eventHandlers) return

  for (const handler of eventHandlers) {
    await handler(payload)
  }

}