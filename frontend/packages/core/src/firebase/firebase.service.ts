import { Injectable } from '@angular/core';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import {
  Firestore,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
} from 'firebase/firestore';

const EMULATOR_FLAG = '__MOCKTAIL_USE_EMULATORS__';
// Named Firestore database for this app. The project also hosts sibling
// databases (hooklab, azadi) so we cannot rely on (default) — it doesn't exist.
const FIRESTORE_DATABASE_ID = 'mocktail';

interface FirebaseWindowConfig {
  __FIREBASE_API_KEY__?: string;
  __FIREBASE_AUTH_DOMAIN__?: string;
  __FIREBASE_PROJECT_ID__?: string;
  __FIREBASE_APP_ID__?: string;
  [EMULATOR_FLAG]?: boolean;
}

/**
 * Central Firebase bootstrap. Provided at root so every service that needs
 * Firestore/Auth resolves the same app instance rather than initialising
 * side-effect singletons scattered across files.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  public readonly app: FirebaseApp;
  public readonly auth: Auth;
  public readonly db: Firestore;
  public readonly useEmulator: boolean;

  constructor() {
    const cfg = globalThis as unknown as FirebaseWindowConfig;
    this.useEmulator = cfg[EMULATOR_FLAG] === true;

    const productionConfig = {
      apiKey: cfg.__FIREBASE_API_KEY__ ?? '',
      authDomain: cfg.__FIREBASE_AUTH_DOMAIN__ ?? '',
      projectId: cfg.__FIREBASE_PROJECT_ID__ ?? '',
      appId: cfg.__FIREBASE_APP_ID__ ?? '',
    };
    const emulatorConfig = {
      apiKey: 'demo-key',
      projectId: 'demo-mocktail',
      authDomain: 'localhost',
    };

    const existing = getApps()[0];
    this.app = existing ?? initializeApp(this.useEmulator ? emulatorConfig : productionConfig);
    this.auth = getAuth(this.app);
    this.db = existing
      ? getFirestore(this.app, FIRESTORE_DATABASE_ID)
      : this.useEmulator
        ? getFirestore(this.app, FIRESTORE_DATABASE_ID)
        : initializeFirestore(
            this.app,
            { localCache: persistentLocalCache() },
            FIRESTORE_DATABASE_ID,
          );

    if (this.useEmulator && !existing) {
      connectAuthEmulator(this.auth, 'http://localhost:9099');
      connectFirestoreEmulator(this.db, 'localhost', 8083);
      this._wireTestBackdoor();
    }

    setPersistence(this.auth, browserSessionPersistence).catch((err) =>
      console.error('[firebase] setPersistence failed', err),
    );
  }

  private _wireTestBackdoor(): void {
    // Test-only backdoor to bypass Google OAuth popup in Playwright against
    // the emulator. Never enabled in production (guarded by useEmulator).
    (globalThis as unknown as Record<string, unknown>)['__mocktailTestLogin'] = async (
      email: string,
    ) => {
      const mod = await import('firebase/auth');
      try {
        await mod.createUserWithEmailAndPassword(this.auth, email, 'TestPass!123');
      } catch {
        // User already exists — fall through to sign-in.
      }
      await mod.signInWithEmailAndPassword(this.auth, email, 'TestPass!123');
    };
  }
}
