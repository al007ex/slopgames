// The socket, and the business of getting it back when it drops.
//
// The game server sleeps when nobody is playing and the portal wakes it on
// demand, so "the connection failed several times running" usually means it
// went to sleep — the UI offers a reload, which goes through the portal again.

import { decodeServer } from '#shared/protocol.js';

const BACKOFF = [500, 1000, 2000, 3000, 5000, 8000];

export class Net {
  constructor(url, { onMessage, onStatus }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.failures = 0;
    this.everOpened = false;
    this.connect();
  }

  get open() { return this.ws?.readyState === WebSocket.OPEN; }

  connect() {
    this.onStatus(this.everOpened ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.failures = 0;
      this.everOpened = true;
      this.onStatus('open');
    };
    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      let message;
      try { message = decodeServer(event.data); } catch { return; }
      this.onMessage(message, performance.now());
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.failures += 1;
      if (this.failures > BACKOFF.length) { this.onStatus('asleep'); return; }
      this.onStatus('reconnecting');
      setTimeout(() => this.connect(), BACKOFF[this.failures - 1]);
    };
  }

  send(bytes) {
    if (this.open) this.ws.send(bytes);
  }
}
