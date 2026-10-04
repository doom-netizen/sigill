// Minimal event emitter that works everywhere (no node:events).
type Fn = (...args: any[]) => void;

export class Emitter {
  private handlers = new Map<string, Set<Fn>>();
  on(event: string, fn: Fn): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: Fn): this {
    this.handlers.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, ...args: unknown[]): boolean {
    const set = this.handlers.get(event);
    if (!set?.size) return false;
    for (const fn of [...set]) {
      try { fn(...args); } catch (e) { console.error(e); }
    }
    return true;
  }
}
