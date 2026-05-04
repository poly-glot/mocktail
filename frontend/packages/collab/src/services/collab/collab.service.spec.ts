import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '@mocktail/auth';
import { of } from 'rxjs';
import { CollabService } from './collab.service';

class FakeAuthService {
  user = signal<{ uid: string; displayName?: string; email?: string } | null>({
    uid: 'u1',
    displayName: 'Test',
    email: 't@e.com',
  });
  isLoading = signal(false);
  isLoading$ = of(false);
}

describe('CollabService', () => {
  let service: CollabService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useClass: FakeAuthService }],
    });
    service = TestBed.inject(CollabService);
  });

  it('starts disconnected with empty cursors', () => {
    expect(service.connected()).toBe(false);
    expect(service.cursors().size).toBe(0);
  });

  it('disconnect() without connect is safe', () => {
    expect(() => service.disconnect()).not.toThrow();
  });

  it('sendCursor throttles and queues before connection', () => {
    service.sendCursor(1, 2);
    service.sendCursor(3, 4);
    expect(service.connected()).toBe(false);
  });

  it('sendSelection and sendEdit are safe before connection', () => {
    expect(() => service.sendSelection('el-1')).not.toThrow();
    expect(() => service.sendEdit('el-1', { x: 10 })).not.toThrow();
  });

  it('flushPendingEdits is a no-op when no edits are buffered', () => {
    expect(() => service.flushPendingEdits()).not.toThrow();
  });

  it('flushPendingEdits forces a send even within the 33ms throttle window', () => {
    const sent: string[] = [];
    const fake: Partial<WebSocket> = {
      readyState: WebSocket.OPEN,
      addEventListener: () => undefined,
      send: ((text: string) => sent.push(text)) as WebSocket['send'],
      close: jasmine.createSpy('close'),
    };
    spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
    service.connect('tenant-a', 'proj1');
    sent.length = 0;

    service.sendEdit('el-1', { x: 10 });
    const editsAfterFirst = sent.filter((t) => t.includes('"type":"edit"')).length;

    service.sendEdit('el-1', { y: 20 });
    service.flushPendingEdits();

    const editFrames = sent.filter((t) => t.includes('"type":"edit"'));
    expect(editFrames.length).toBeGreaterThan(editsAfterFirst);
    const last = editFrames[editFrames.length - 1];
    expect(last).toContain('"y":20');
  });

  it('connect() opens a socket and installs listeners', () => {
    const listeners: Record<string, (ev?: unknown) => void> = {};
    const fake: Partial<WebSocket> = {
      readyState: 0,
      addEventListener: (t: string, cb: (ev?: unknown) => void) => {
        listeners[t] = cb;
      },
      send: jasmine.createSpy('send'),
      close: jasmine.createSpy('close'),
    };
    const wsSpy = spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
    service.connect('tenant-a', 'proj1');
    // URL carries tenant + project so the Zig proxy can build the Firestore path.
    expect(wsSpy.calls.mostRecent().args[0]).toContain('/api/collab/tenant-a/proj1');
    expect(typeof listeners['open']).toBe('function');

    (fake as unknown as { readyState: number }).readyState = WebSocket.OPEN;
    listeners['open']?.();
    expect(service.connected()).toBe(true);

    listeners['message']?.({
      data: JSON.stringify({
        type: 'cursor',
        userId: 'other',
        name: 'O',
        color: '#0a0a0a',
        x: 5,
        y: 6,
      }),
    } as MessageEvent);
    expect(service.cursors().get('other')?.x).toBe(5);

    listeners['message']?.({
      data: JSON.stringify({
        type: 'roster',
        members: [{ userId: 'x', name: 'X', color: '#000' }],
      }),
    } as MessageEvent);
    expect(service.cursors().has('x')).toBe(true);

    listeners['message']?.({
      data: JSON.stringify({ type: 'leave', userId: 'other' }),
    } as MessageEvent);
    expect(service.cursors().has('other')).toBe(false);

    listeners['message']?.({
      data: JSON.stringify({ type: 'edit', elementId: 'e1', patch: { x: 9 }, userId: 'a' }),
    } as MessageEvent);
    expect(service.lastRemoteEdit()?.elementId).toBe('e1');

    listeners['message']?.({
      data: JSON.stringify({ type: 'delete', elementId: 'e2', userId: 'a' }),
    } as MessageEvent);
    expect(service.lastRemoteDelete()?.elementId).toBe('e2');

    listeners['message']?.({
      data: JSON.stringify({
        type: 'deleteFields',
        elementId: 'e3',
        fields: ['color', 'borderColor'],
        userId: 'a',
      }),
    } as MessageEvent);
    expect(service.lastRemoteDeleteFields()?.elementId).toBe('e3');
    expect(service.lastRemoteDeleteFields()?.fields).toEqual(['color', 'borderColor']);

    listeners['message']?.({ data: 'not-json' } as MessageEvent);

    listeners['close']?.();
    expect(service.connected()).toBe(false);
  });

  it('sendDelete emits a delete frame and flushes pending edits first', () => {
    const sent: string[] = [];
    const fake: Partial<WebSocket> = {
      readyState: WebSocket.OPEN,
      addEventListener: () => undefined,
      send: ((text: string) => sent.push(text)) as WebSocket['send'],
      close: jasmine.createSpy('close'),
    };
    spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
    service.connect('tenant-a', 'proj1');
    sent.length = 0;

    service.sendEdit('el-1', { x: 10 });
    service.sendDelete('el-1');

    const editIdx = sent.findIndex((t) => t.includes('"type":"edit"'));
    const delIdx = sent.findIndex((t) => t.includes('"type":"delete"'));
    expect(editIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeGreaterThan(editIdx);
    expect(sent[delIdx]).toContain('"elementId":"el-1"');
  });

  it('sendDeleteFields emits a deleteFields frame; empty list is a no-op', () => {
    const sent: string[] = [];
    const fake: Partial<WebSocket> = {
      readyState: WebSocket.OPEN,
      addEventListener: () => undefined,
      send: ((text: string) => sent.push(text)) as WebSocket['send'],
      close: jasmine.createSpy('close'),
    };
    spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
    service.connect('tenant-a', 'proj1');
    sent.length = 0;

    service.sendDeleteFields('el-1', []);
    expect(sent.filter((t) => t.includes('deleteFields')).length).toBe(0);

    service.sendDeleteFields('el-1', ['color', 'borderColor']);
    const frame = sent.find((t) => t.includes('"type":"deleteFields"'));
    expect(frame).toBeTruthy();
    expect(frame).toContain('"elementId":"el-1"');
    expect(frame).toContain('"color"');
    expect(frame).toContain('"borderColor"');
  });

  it('sends a heartbeat after 30s of send-silence; suppressed by intervening sends', () => {
    jasmine.clock().install();
    try {
      const sent: string[] = [];
      const fake: Partial<WebSocket> = {
        readyState: WebSocket.OPEN,
        addEventListener: (_t: string, _cb: (ev?: unknown) => void) => undefined,
        send: ((text: string) => sent.push(text)) as WebSocket['send'],
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
      service.connect('tenant-a', 'proj1');

      // Use sendSelection (no throttle) instead of sendCursor — sendCursor is
      // throttled by 33ms keyed off performance.now(), which jasmine.clock()
      // doesn't mock. Either method calls _send and arms the heartbeat timer
      // identically, so semantics are preserved.
      service.sendSelection('el-1');
      sent.length = 0;

      // Within 30 s with intervening sends → no heartbeat fires.
      jasmine.clock().tick(20_000);
      service.sendSelection('el-2');
      jasmine.clock().tick(15_000);
      expect(sent.filter((t) => t.includes('"type":"heartbeat"')).length).toBe(0);

      // Now stay silent for 30 s → exactly one heartbeat fires.
      sent.length = 0;
      jasmine.clock().tick(30_000);
      const hbs = sent.filter((t) => t.includes('"type":"heartbeat"'));
      expect(hbs.length).toBe(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('disconnect() clears the heartbeat timer (no further heartbeats fire)', () => {
    jasmine.clock().install();
    try {
      const sent: string[] = [];
      const fake: Partial<WebSocket> = {
        readyState: WebSocket.OPEN,
        addEventListener: (_t: string, _cb: (ev?: unknown) => void) => undefined,
        send: ((text: string) => sent.push(text)) as WebSocket['send'],
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
      service.connect('tenant-a', 'proj1');
      service.sendCursor(0, 0); // arms the heartbeat timer
      sent.length = 0;

      service.disconnect();

      jasmine.clock().tick(120_000);
      expect(sent.filter((t) => t.includes('"type":"heartbeat"')).length).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
