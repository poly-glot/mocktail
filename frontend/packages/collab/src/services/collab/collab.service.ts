import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '@mocktail/auth';
import { filter, firstValueFrom } from 'rxjs';

export interface ICursorState {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeenMs: number;
  selection?: string;
}

export interface IRemoteEdit {
  elementId: string;
  patch: Record<string, unknown>;
  from: string;
}

export interface IRemoteDelete {
  elementId: string;
  from: string;
}

export interface IRemoteDeleteFields {
  elementId: string;
  fields: string[];
  from: string;
}

@Injectable({ providedIn: 'root' })
export class CollabService {
  public readonly connected = signal(false);
  public readonly cursors = signal<Map<string, ICursorState>>(new Map());
  public readonly lastRemoteEdit = signal<IRemoteEdit | null>(null);
  public readonly lastRemoteDelete = signal<IRemoteDelete | null>(null);
  public readonly lastRemoteDeleteFields = signal<IRemoteDeleteFields | null>(null);

  private readonly _authService = inject(AuthService);

  private _socket: WebSocket | null = null;
  private _currentTenantId: string | null = null;
  private _currentProjectId: string | null = null;
  private _sendQueue: string[] = [];
  private _cursorThrottleAt = 0;
  private _editThrottleAt = 0;
  private _pendingEditPatches = new Map<string, Record<string, unknown>>();
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _HEARTBEAT_INTERVAL_MS = 30_000;
  private _intentionalClose = false;

  /**
   * Connect to the collab room for `tenantId/projectId`. The tenant is part
   * of the URL so the Zig proxy can build the Firestore document path
   * (`tenants/{tid}/projects/{pid}/elements/...`) for server-side flushes.
   * Reconnect is a no-op when already pointed at the same tenant+project.
   */
  public connect(tenantId: string, projectId: string): void {
    if (
      this._currentTenantId === tenantId &&
      this._currentProjectId === projectId &&
      this._socket &&
      this._socket.readyState <= WebSocket.OPEN
    )
      return;
    this.disconnect();
    this._intentionalClose = false;
    this._currentTenantId = tenantId;
    this._currentProjectId = projectId;
    this._openSocket();
  }

  public disconnect(): void {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    try {
      this._socket?.close();
    } catch {
      // ignore
    }
    this._socket = null;
    this._currentTenantId = null;
    this._currentProjectId = null;
    this._reconnectAttempts = 0;
    this._pendingEditPatches.clear();
    this.connected.set(false);
    this.cursors.set(new Map());
  }

  public sendCursor(x: number, y: number, selection?: string): void {
    const now = performance.now();
    if (now - this._cursorThrottleAt < 33) return;
    this._cursorThrottleAt = now;
    this._send({ type: 'cursor', x, y, selection, ...this._identity() });
  }

  public sendSelection(elementId: string | null): void {
    this._send({ type: 'selection', elementId, ...this._identity() });
  }

  public sendEdit(elementId: string, patch: Record<string, unknown>): void {
    const existing = this._pendingEditPatches.get(elementId) ?? {};
    this._pendingEditPatches.set(elementId, { ...existing, ...patch });
    const now = performance.now();
    if (now - this._editThrottleAt < 33) return;
    this._editThrottleAt = now;
    this._flushEdits();
  }

  /**
   * Force-flush any throttled edit patches. Gesture endpoints (pointer-up,
   * inspector commit) call this so the last patch in a burst reaches the Zig
   * proxy promptly instead of waiting for the next sendEdit to unblock the
   * 33ms throttle.
   */
  public flushPendingEdits(): void {
    if (this._pendingEditPatches.size === 0) return;
    this._editThrottleAt = performance.now();
    this._flushEdits();
  }

  /**
   * Send a full-document delete for the element. Flushes any throttled edits
   * first so the delete arrives strictly after them — the Zig proxy already
   * drops queued edits when a delete lands, but ordering keeps the protocol
   * predictable for peers receiving the broadcast.
   */
  public sendDelete(elementId: string): void {
    this.flushPendingEdits();
    this._send({ type: 'delete', elementId, ...this._identity() });
  }

  /**
   * Remove specific fields from an element document. Used for "clear color"
   * and similar inspector actions that previously called Firebase deleteField.
   */
  public sendDeleteFields(elementId: string, fields: string[]): void {
    if (fields.length === 0) return;
    this.flushPendingEdits();
    this._send({ type: 'deleteFields', elementId, fields, ...this._identity() });
  }

  private _identity(): { userId: string; name: string; color: string } {
    const u = this._authService.user();
    return {
      userId: u?.uid ?? 'anon',
      name: u?.displayName ?? u?.email?.split('@')[0] ?? 'Guest',
      color: this._colorFor(u?.uid ?? 'anon'),
    };
  }

  private _openSocket(): void {
    const tenantId = this._currentTenantId;
    const projectId = this._currentProjectId;
    if (!projectId) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // The server accepts both `/api/collab/{tid}/{pid}` (Phase 1 — Firestore
    // write path enabled) and `/api/collab/{pid}` (legacy — broadcast only).
    // We always send the two-segment form so the proxy can commit on our
    // behalf; only fall back if tenantId is unexpectedly empty.
    const path = tenantId
      ? `/api/collab/${encodeURIComponent(tenantId)}/${encodeURIComponent(projectId)}`
      : `/api/collab/${encodeURIComponent(projectId)}`;
    // Firebase Hosting's edge mangles WebSocket upgrade headers when proxying
    // through `/api/**` rewrites to Cloud Run, returning 400. Bypass Hosting
    // for WS by hitting the run.app URL directly. Same-origin XHR is unchanged.
    const wsHost =
      (globalThis as unknown as { __MOCKTAIL_WS_HOST__?: string }).__MOCKTAIL_WS_HOST__ ??
      location.host;
    const url = `${scheme}//${wsHost}${path}`;
    const ws = new WebSocket(url);
    this._socket = ws;
    ws.addEventListener('open', () => {
      this.connected.set(true);
      this._reconnectAttempts = 0;
      // Auth may still be resolving when the route activates (authGuard lets
      // loading states through). Defer the hello so our identity isn't 'Guest'.
      void this._sendHelloWhenAuthReady(ws);
    });
    ws.addEventListener('close', () => {
      this.connected.set(false);
      this._socket = null;
      this.cursors.set(new Map());
      if (this._heartbeatTimer) {
        clearTimeout(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
      if (!this._intentionalClose && this._currentProjectId) {
        this._scheduleReconnect();
      }
    });
    ws.addEventListener('error', () => {
      this.connected.set(false);
    });
    ws.addEventListener('message', (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : null;
      if (!text) return;
      try {
        const msg = JSON.parse(text);
        this._handleMessage(msg);
      } catch {
        // ignore non-JSON
      }
    });
  }

  private async _sendHelloWhenAuthReady(ws: WebSocket): Promise<void> {
    if (this._authService.isLoading()) {
      await firstValueFrom(this._authService.isLoading$.pipe(filter((l) => !l)));
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    const u = this._authService.user();
    const hello = {
      type: 'hello',
      userId: u?.uid ?? 'anon',
      name: u?.displayName ?? u?.email?.split('@')[0] ?? 'Guest',
      color: this._colorFor(u?.uid ?? 'anon'),
    };
    ws.send(JSON.stringify(hello));
    while (this._sendQueue.length) {
      const msg = this._sendQueue.shift();
      if (msg) ws.send(msg);
    }
    this._resetHeartbeat();
  }

  private _scheduleReconnect(): void {
    if (this._reconnectTimer) return;
    const delay = Math.min(30_000, 500 * Math.pow(2, this._reconnectAttempts++));
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._intentionalClose && this._currentProjectId) this._openSocket();
    }, delay);
  }

  /**
   * Reset-on-send heartbeat. Re-armed by every `_send`; fires
   * `{"type":"heartbeat"}` if 30 s elapses with no other outbound traffic.
   * Cursor frames at 30 Hz arm this naturally during active editing — the
   * heartbeat only ever fires when the user is genuinely quiet, preventing
   * the server's 60 s per-connection idle cull.
   */
  private _resetHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._heartbeatTimer = setTimeout(() => {
      // Skip if disconnected; do NOT fall back to _sendQueue. A long outage
      // must not fill the 64-slot queue with stale heartbeats.
      if (this._socket?.readyState === WebSocket.OPEN) {
        this._socket.send('{"type":"heartbeat"}');
        this._resetHeartbeat();
      }
    }, CollabService._HEARTBEAT_INTERVAL_MS);
  }

  private _flushEdits(): void {
    const id = this._identity();
    for (const [elementId, patch] of this._pendingEditPatches) {
      this._send({ type: 'edit', elementId, patch, ...id });
    }
    this._pendingEditPatches.clear();
  }

  private _send(payload: unknown): void {
    const text = JSON.stringify(payload);
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      this._socket.send(text);
      this._resetHeartbeat();
    } else {
      if (this._sendQueue.length < 64) this._sendQueue.push(text);
    }
  }

  private _handleMessage(msg: Record<string, unknown>): void {
    if (!msg || typeof msg !== 'object') return;
    const t = msg['type'];
    if (t === 'hello') {
      // Peer joined; register their identity so cursor frames can look them up
      // and the presence strip shows the right name/color before they move.
      const userId = String(msg['userId'] ?? '');
      if (!userId) return;
      if (userId === (this._authService.user()?.uid ?? 'anon')) return;
      this.cursors.update((m) => {
        const next = new Map(m);
        if (!next.has(userId)) {
          next.set(userId, {
            userId,
            name: String(msg['name'] ?? 'Guest'),
            color: String(msg['color'] ?? '#0a0a0a'),
            x: -999,
            y: -999,
            lastSeenMs: Date.now(),
          });
        } else {
          const existing = next.get(userId)!;
          next.set(userId, {
            ...existing,
            name: String(msg['name'] ?? existing.name),
            color: String(msg['color'] ?? existing.color),
          });
        }
        return next;
      });
      return;
    }
    if (t === 'cursor') {
      const userId = String(msg['userId'] ?? 'unknown');
      if (userId === (this._authService.user()?.uid ?? 'anon')) return;
      this.cursors.update((m) => {
        const next = new Map(m);
        const existing = next.get(userId);
        next.set(userId, {
          userId,
          name: String(msg['name'] ?? existing?.name ?? 'Guest'),
          color: String(msg['color'] ?? existing?.color ?? '#0a0a0a'),
          x: Number(msg['x'] ?? 0),
          y: Number(msg['y'] ?? 0),
          lastSeenMs: Date.now(),
          selection: msg['selection'] as string | undefined,
        });
        return next;
      });
    } else if (t === 'roster') {
      const members = Array.isArray(msg['members'])
        ? (msg['members'] as Record<string, unknown>[])
        : [];
      this.cursors.update((m) => {
        const next = new Map(m);
        const selfId = this._authService.user()?.uid ?? 'anon';
        for (const mem of members) {
          if (!mem || mem['userId'] === selfId) continue;
          const uid = mem['userId'] as string;
          if (!next.has(uid)) {
            next.set(uid, {
              userId: uid,
              name: (mem['name'] as string) ?? 'Guest',
              color: (mem['color'] as string) ?? '#0a0a0a',
              x: -999,
              y: -999,
              lastSeenMs: Date.now(),
            });
          }
        }
        return next;
      });
    } else if (t === 'leave') {
      const userId = String(msg['userId'] ?? '');
      if (!userId) return;
      this.cursors.update((m) => {
        const next = new Map(m);
        next.delete(userId);
        return next;
      });
    } else if (t === 'edit') {
      this.lastRemoteEdit.set({
        elementId: String(msg['elementId'] ?? ''),
        patch: (msg['patch'] ?? {}) as Record<string, unknown>,
        from: String(msg['userId'] ?? ''),
      });
    } else if (t === 'delete') {
      const elementId = String(msg['elementId'] ?? '');
      if (!elementId) return;
      this.lastRemoteDelete.set({
        elementId,
        from: String(msg['userId'] ?? ''),
      });
    } else if (t === 'deleteFields') {
      const elementId = String(msg['elementId'] ?? '');
      const fields = Array.isArray(msg['fields'])
        ? (msg['fields'] as unknown[]).map((f) => String(f))
        : [];
      if (!elementId || fields.length === 0) return;
      this.lastRemoteDeleteFields.set({
        elementId,
        fields,
        from: String(msg['userId'] ?? ''),
      });
    }
  }

  private _colorFor(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const palette = ['#0a0a0a', '#1f2937', '#b45309', '#065f46', '#1e3a8a', '#7c3aed', '#be123c'];
    return palette[Math.abs(h) % palette.length];
  }
}
