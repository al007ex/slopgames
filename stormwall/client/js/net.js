// The socket: JSON for the lobby and rare events, binary for the hot path.
// Works under any sub-path — the URL is built from the page's own location.

import { Writer, encodeInput, encodePing, S_SNAPSHOT, S_PONG, Reader } from '#shared/protocol.js';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = { json: () => {}, snapshot: () => {}, open: () => {}, close: () => {} };
    this.writer = new Writer(256);
    this.pingWriter = new Writer(16);
    this.rtt = 0;
    this.pingTimer = null;
    this.bytesIn = 0;
  }

  get url() {
    const u = new URL('ws', window.location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.href;
  }

  connect() {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.open();
      this.pingTimer = setInterval(() => this.sendBinary(encodePing(this.pingWriter, performance.now())), 2000);
    };
    ws.onclose = (e) => { clearInterval(this.pingTimer); this.handlers.close(e); };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this.handlers.json(msg);
        return;
      }
      this.bytesIn += e.data.byteLength;
      const type = new Uint8Array(e.data)[0];
      if (type === S_SNAPSHOT) this.handlers.snapshot(e.data);
      else if (type === S_PONG) {
        const r = new Reader(e.data); r.u8();
        const sample = performance.now() - r.f64();
        this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
      }
    };
  }

  get open() { return this.ws && this.ws.readyState === WebSocket.OPEN; }
  on(event, fn) { this.handlers[event] = fn; }
  sendJson(obj) { if (this.open) this.ws.send(JSON.stringify(obj)); }
  sendBinary(bytes) { if (this.open) this.ws.send(bytes); }
  sendInput(input) { this.sendBinary(encodeInput(this.writer, input)); }
  close() { if (this.ws) this.ws.close(); }
}
