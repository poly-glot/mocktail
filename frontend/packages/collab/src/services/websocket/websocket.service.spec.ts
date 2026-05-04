import { TestBed } from '@angular/core/testing';
import { WebsocketService } from './websocket.service';

describe('WebsocketService', () => {
  let service: WebsocketService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebsocketService);
  });

  it('initializes with idle status and empty log', () => {
    expect(service.status()).toBe('idle');
    expect(service.log()).toEqual([]);
  });

  it('builds a ws url against location origin', () => {
    const url = service.url('/api/ws');
    expect(url).toMatch(/^wss?:\/\/[^/]+\/api\/ws$/);
  });

  it('returns false when sending without an open socket', () => {
    expect(service.send('hi')).toBe(false);
  });

  it('transitions to connecting and logs on connect()', () => {
    const fakeSocket: Partial<WebSocket> & { listeners: Record<string, (ev?: unknown) => void> } = {
      readyState: 0,
      listeners: {},
      addEventListener(type: string, cb: (ev?: unknown) => void) {
        this.listeners[type] = cb;
      },
      close() {},
      send() {},
    };
    spyOn(window, 'WebSocket').and.returnValue(fakeSocket as unknown as WebSocket);
    service.connect('/api/ws');
    expect(service.status()).toBe('connecting');
    expect(service.log().length).toBe(1);

    fakeSocket.listeners['open']?.();
    expect(service.status()).toBe('open');

    fakeSocket.listeners['message']?.({ data: 'hello' } as MessageEvent);
    expect(service.log().some((e) => e.direction === 'in' && e.text === 'hello')).toBe(true);

    fakeSocket.listeners['close']?.();
    expect(service.status()).toBe('closed');
  });

  it('close() is a no-op when no socket', () => {
    expect(() => service.close()).not.toThrow();
  });
});
