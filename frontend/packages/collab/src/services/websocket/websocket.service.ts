import { Injectable, signal } from '@angular/core';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface ILogEntry {
  direction: 'system' | 'out' | 'in';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  public readonly status = signal<WsStatus>('idle');
  public readonly log = signal<ILogEntry[]>([]);

  private _socket: WebSocket | null = null;

  public url(path = '/api/ws'): string {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}${path}`;
  }

  public connect(path = '/api/ws'): void {
    if (this._socket && this._socket.readyState <= WebSocket.OPEN) return;
    const target = this.url(path);
    this.status.set('connecting');
    this._push('system', `connecting to ${target}`);

    const ws = new WebSocket(target);
    this._socket = ws;

    ws.addEventListener('open', () => {
      this.status.set('open');
      this._push('system', `open ${target}`);
    });
    ws.addEventListener('message', (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : '[binary]';
      this._push('in', text);
    });
    ws.addEventListener('close', () => {
      this.status.set('closed');
      this._push('system', 'closed');
      this._socket = null;
    });
    ws.addEventListener('error', () => {
      this.status.set('error');
      this._push('system', 'error');
    });
  }

  public send(text: string): boolean {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return false;
    this._socket.send(text);
    this._push('out', text);
    return true;
  }

  public close(): void {
    this._socket?.close();
  }

  private _push(direction: ILogEntry['direction'], text: string): void {
    this.log.update((entries) => [...entries, { direction, text }]);
  }
}
