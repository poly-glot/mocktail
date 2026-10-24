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

  describe('inbound frames', () => {
    let listeners: Record<string, (ev?: unknown) => void>;
    let sent: string[];
    let fake: Partial<WebSocket> & { readyState: number };

    const receive = (frame: unknown): void =>
      listeners['message']?.({
        data: typeof frame === 'string' ? frame : JSON.stringify(frame),
      } as MessageEvent);

    beforeEach(() => {
      listeners = {};
      sent = [];
      fake = {
        readyState: WebSocket.OPEN,
        addEventListener: (t: string, cb: (ev?: unknown) => void) => {
          listeners[t] = cb;
        },
        send: ((text: string) => sent.push(text)) as WebSocket['send'],
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
      service.connect('tenant-a', 'proj1');
    });

    it('hello adds an offscreen peer, updates it on repeat, and ignores self and anonymous', () => {
      receive({ type: 'hello', userId: 'p1' });
      expect(service.cursors().get('p1')).toEqual(
        jasmine.objectContaining({ name: 'Guest', color: '#0a0a0a', x: -999, y: -999 }),
      );

      receive({ type: 'hello', userId: 'p1', name: 'Pat' });
      expect(service.cursors().get('p1')?.name).toBe('Pat');
      expect(service.cursors().get('p1')?.color).toBe('#0a0a0a');

      receive({ type: 'hello', userId: 'u1', name: 'Me' });
      receive({ type: 'hello' });
      expect(service.cursors().size).toBe(1);
    });

    it('cursor defaults missing fields, keeps a known peer name, and ignores self', () => {
      receive({ type: 'cursor' });
      expect(service.cursors().get('unknown')).toEqual(
        jasmine.objectContaining({ name: 'Guest', color: '#0a0a0a', x: 0, y: 0 }),
      );

      receive({ type: 'hello', userId: 'p1', name: 'Pat', color: '#111' });
      receive({ type: 'cursor', userId: 'p1', x: 3 });
      expect(service.cursors().get('p1')).toEqual(
        jasmine.objectContaining({ name: 'Pat', color: '#111', x: 3, y: 0 }),
      );

      receive({ type: 'cursor', userId: 'u1', x: 9 });
      expect(service.cursors().has('u1')).toBe(false);
    });

    it('roster tolerates a missing list and skips self, duplicates and nameless members', () => {
      receive({ type: 'roster' });
      expect(service.cursors().size).toBe(0);

      receive({ type: 'hello', userId: 'p1', name: 'Pat' });
      receive({
        type: 'roster',
        members: [{ userId: 'u1' }, { userId: 'p1', name: 'Other' }, {}, null, { userId: 'p2' }],
      });
      expect([...service.cursors().keys()]).toEqual(['p1', 'p2']);
      expect(service.cursors().get('p1')?.name).toBe('Pat');
    });

    it('leave, edit, delete and deleteFields default their fields and skip empty ids', () => {
      receive({ type: 'leave' });
      receive({ type: 'edit' });
      expect(service.lastRemoteEdit()).toEqual({ elementId: '', patch: {}, from: '' });

      receive({ type: 'delete' });
      expect(service.lastRemoteDelete()).toBeNull();
      receive({ type: 'delete', elementId: 'e1' });
      expect(service.lastRemoteDelete()).toEqual({ elementId: 'e1', from: '' });

      receive({ type: 'deleteFields', elementId: 'e1' });
      receive({ type: 'deleteFields', fields: ['x'] });
      expect(service.lastRemoteDeleteFields()).toBeNull();
      receive({ type: 'deleteFields', elementId: 'e1', fields: [1] });
      expect(service.lastRemoteDeleteFields()).toEqual({
        elementId: 'e1',
        fields: ['1'],
        from: '',
      });
    });

    it('ignores unknown types, non-object payloads and binary frames', () => {
      receive({ type: 'nope' });
      receive('null');
      receive('42');
      listeners['message']?.({ data: new ArrayBuffer(1) } as MessageEvent);
      expect(service.cursors().size).toBe(0);
    });

    it('connect() to the same room is a no-op; a new room reopens the socket', () => {
      const ws = window.WebSocket as unknown as jasmine.Spy;
      service.connect('tenant-a', 'proj1');
      expect(ws.calls.count()).toBe(1);

      service.connect('tenant-a', 'proj2');
      expect(ws.calls.count()).toBe(2);
      expect(ws.calls.mostRecent().args[0]).toContain('/api/collab/tenant-a/proj2');
    });

    it('falls back to the single-segment path when tenantId is empty', () => {
      service.connect('', 'proj3');
      const url = (window.WebSocket as unknown as jasmine.Spy).calls.mostRecent().args[0];
      expect(url).toMatch(/\/api\/collab\/proj3$/);
    });

    it('reconnects with backoff after an unintentional close and not after disconnect()', () => {
      jasmine.clock().install();
      try {
        const ws = window.WebSocket as unknown as jasmine.Spy;
        listeners['close']?.();
        jasmine.clock().tick(499);
        expect(ws.calls.count()).toBe(1);
        jasmine.clock().tick(1);
        expect(ws.calls.count()).toBe(2);

        listeners['close']?.();
        listeners['close']?.();
        jasmine.clock().tick(1_000);
        expect(ws.calls.count()).toBe(3);

        service.disconnect();
        listeners['close']?.();
        jasmine.clock().tick(60_000);
        expect(ws.calls.count()).toBe(3);
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('open sends hello then drains frames queued while closed; error flips connected off', async () => {
      fake.readyState = WebSocket.CONNECTING;
      service.sendSelection('queued');
      expect(sent.length).toBe(0);

      fake.readyState = WebSocket.OPEN;
      listeners['open']?.();
      await Promise.resolve();
      expect(sent[0]).toContain('"type":"hello"');
      expect(sent[0]).toContain('"userId":"u1"');
      expect(sent[1]).toContain('"elementId":"queued"');

      listeners['error']?.();
      expect(service.connected()).toBe(false);
    });

    it('open skips hello when the socket closed before auth resolved', async () => {
      fake.readyState = WebSocket.CLOSED;
      listeners['open']?.();
      await Promise.resolve();
      expect(sent.length).toBe(0);
    });
  });

  describe('identity fallbacks', () => {
    const sendSelectionFrame = (): string => {
      const sent: string[] = [];
      const fake: Partial<WebSocket> = {
        readyState: WebSocket.OPEN,
        addEventListener: () => undefined,
        send: ((text: string) => sent.push(text)) as WebSocket['send'],
        close: jasmine.createSpy('close'),
      };
      spyOn(window, 'WebSocket').and.returnValue(fake as WebSocket);
      service.connect('tenant-a', 'proj1');
      service.sendSelection('el');
      return sent.find((t) => t.includes('"type":"selection"')) ?? '';
    };

    it('uses the email local part when displayName is missing', () => {
      (TestBed.inject(AuthService) as unknown as FakeAuthService).user.set({
        uid: 'u2',
        email: 'pat@example.com',
      });
      expect(sendSelectionFrame()).toContain('"name":"pat"');
    });

    it('falls back to anon/Guest when signed out', () => {
      (TestBed.inject(AuthService) as unknown as FakeAuthService).user.set(null);
      const frame = sendSelectionFrame();
      expect(frame).toContain('"userId":"anon"');
      expect(frame).toContain('"name":"Guest"');
    });
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
