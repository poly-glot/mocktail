import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';

export function enableEmulatorFlag(): void {
  (globalThis as unknown as Record<string, unknown>)['__MOCKTAIL_USE_EMULATORS__'] = true;
}

export function uniqueEmail(prefix = 'u'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@test.mocktail`;
}

export async function signInTestUser(auth: Auth, email = uniqueEmail()): Promise<string> {
  try {
    await createUserWithEmailAndPassword(auth, email, 'TestPass!123');
  } catch {
    // user may exist
  }
  const cred = await signInWithEmailAndPassword(auth, email, 'TestPass!123');
  return cred.user.uid;
}

export async function signOutTestUser(auth: Auth): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // noop
  }
}

export async function clearFirestoreEmulator(projectId = 'demo-mocktail'): Promise<void> {
  await fetch(
    `http://localhost:8083/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
}
