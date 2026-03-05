export type EventHandler<TPayload> = (payload: TPayload) => void

export class EventBus<TEvents extends object> {
  private readonly listeners: Partial<{
    [K in keyof TEvents]: Set<EventHandler<TEvents[K]>>
  }> = {}

  on<K extends keyof TEvents>(
    event: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void {
    const bucket = this.listeners[event]
    if (bucket !== undefined) {
      bucket.add(handler)
    } else {
      this.listeners[event] = new Set<EventHandler<TEvents[K]>>([handler])
    }

    return () => this.off(event, handler)
  }

  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const bucket = this.listeners[event]
    if (bucket === undefined) {
      return
    }

    bucket.delete(handler)
    if (bucket.size === 0) {
      delete this.listeners[event]
    }
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const bucket = this.listeners[event]
    if (bucket === undefined) {
      return
    }

    for (const handler of bucket) {
      handler(payload)
    }
  }
}
