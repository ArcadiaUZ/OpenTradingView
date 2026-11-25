type Handler = (msg: any) => void;

type Sub = { symbol: string; tf: string; count: number };

class FeedClient {
  private ws: WebSocket | null = null;
  private url = "";
  private handler: Handler = () => undefined;
  private retry = 0;
  private closed = false;
  private queue: object[] = [];
  private subs = new Map<string, Sub>();

  connect(url: string, handler: Handler): void {
    this.url = url;
    this.handler = handler;
    this.closed = false;
    this.open();
  }

  private key(sub: Sub): string {
    return sub.symbol + ":" + sub.tf;
  }

  private open(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.handler({ type: "socket-open" });
      const pending = this.queue;
      this.queue = [];
      pending.forEach((payload) => this.send(payload));
      this.subs.forEach((sub) => this.send({ op: "sub", symbol: sub.symbol, tf: sub.tf, count: sub.count }));
    };
    this.ws.onmessage = (ev) => {
      try {
        this.handler(JSON.parse(ev.data));
      } catch (err) {
        /* ignore malformed frame */
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      this.handler({ type: "socket-close" });
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(5000, 300 * Math.pow(1.6, this.retry));
    this.retry += 1;
    window.setTimeout(() => this.open(), delay);
  }

  send(payload: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      this.queue.push(payload);
      if (this.queue.length > 30) this.queue.shift();
      this.open();
    }
  }

  requestMore(symbol: string, tf: string, before: number, count = 1500): void {
    this.send({ op: "more", symbol, tf, before, count });
  }

  subscribe(symbol: string, tf: string, count = 1500): void {
    const sub = { symbol, tf, count };
    this.subs.set(this.key(sub), sub);
    this.send({ op: "sub", symbol, tf, count });
  }

  unsubscribe(symbol: string, tf: string): void {
    const sub = { symbol, tf, count: 0 };
    this.subs.delete(this.key(sub));
    this.send({ op: "unsub", symbol, tf });
  }
}

// Kept on window so Vite HMR cannot orphan the live socket mid-session.
const globalScope = window as any;
export const feedClient: FeedClient = globalScope.__feedClient || (globalScope.__feedClient = new FeedClient());
