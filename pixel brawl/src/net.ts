type Handler = (msg: any) => void;

export class Net {
  ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: unknown[] = [];
  private token = '';
  private reconnectT: number | null = null;
  private pingT: number | null = null;
  ping = 0;
  connected = false;

  on(type: string, fn: Handler) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(type: string, msg: any) {
    this.handlers.get(type)?.forEach((h) => h(msg));
    this.handlers.get('*')?.forEach((h) => h(msg));
  }

  connect(token: string) {
    this.token = token;
    this.open();
  }

  private open() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const url = `${proto}//${location.host}${base}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'auth', token: this.token });
      for (const q of this.queue) this.raw(q);
      this.queue = [];
      this.emit('open', {});
      if (this.pingT) clearInterval(this.pingT);
      this.pingT = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 3000);
    };

    this.ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.ping = performance.now() - msg.ts;
        return;
      }
      this.emit(msg.t, msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.pingT) clearInterval(this.pingT);
      this.emit('close', {});
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      /* close handler takes care of retrying */
    };
  }

  private scheduleReconnect() {
    if (this.reconnectT) return;
    this.reconnectT = window.setTimeout(() => {
      this.reconnectT = null;
      if (this.token) this.open();
    }, 1500);
  }

  private raw(msg: unknown) {
    this.ws?.send(JSON.stringify(msg));
  }

  send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.raw(msg);
    else this.queue.push(msg);
  }

  close() {
    this.token = '';
    if (this.pingT) clearInterval(this.pingT);
    this.ws?.close();
    this.ws = null;
  }
}
