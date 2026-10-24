import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firestoreSignal } from './firestore-signal';

describe('firestoreSignal', () => {
  it('resubscribes when a read signal changes and unsubscribes the previous listener', () => {
    const tid = signal<string | null>(null);
    const unsubs: jasmine.Spy[] = [];
    let emit: ((v: string[]) => void) | null = null;

    const sig = runInInjectionContext(TestBed.inject(Injector), () =>
      firestoreSignal<string[]>([], (next) => {
        if (!tid()) return null;
        emit = next;
        const unsub = jasmine.createSpy(`unsub-${tid()}`);
        unsubs.push(unsub);
        return unsub;
      }),
    );

    TestBed.tick();
    expect(sig()).toEqual([]);
    expect(unsubs.length).toBe(0);

    tid.set('t1');
    TestBed.tick();
    expect(unsubs.length).toBe(1);
    emit!(['a']);
    expect(sig()).toEqual(['a']);

    tid.set('t2');
    TestBed.tick();
    expect(unsubs[0]).toHaveBeenCalled();
    expect(sig()).toEqual([]);
    expect(unsubs.length).toBe(2);
  });
});
