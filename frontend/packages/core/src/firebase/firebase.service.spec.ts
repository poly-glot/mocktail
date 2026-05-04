import { TestBed } from '@angular/core/testing';
import { FirebaseService } from './firebase.service';

describe('FirebaseService', () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>)['__MOCKTAIL_USE_EMULATORS__'] = true;
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)['__MOCKTAIL_USE_EMULATORS__'];
    delete (globalThis as unknown as Record<string, unknown>)['__mocktailTestLogin'];
  });

  it('initializes with emulator config and wires backdoor', () => {
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(FirebaseService);
    expect(svc.useEmulator).toBe(true);
    expect(svc.app).toBeTruthy();
    expect(svc.auth).toBeTruthy();
    expect(svc.db).toBeTruthy();
    expect(typeof (globalThis as unknown as Record<string, unknown>)['__mocktailTestLogin']).toBe(
      'function',
    );
  });
});
