import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

const isPerfMode = (): boolean =>
  isDevMode() && typeof window !== 'undefined' && window.location.search.includes('perf=1');

const baseRoutes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('@mocktail/auth').then((m) => m.LoginComponent),
  },
  {
    path: 'invite/:token',
    loadComponent: () => import('@mocktail/auth').then((m) => m.InviteAcceptComponent),
  },
  {
    path: '',
    loadChildren: () => import('@mocktail/shell/routing').then((m) => m.routes),
  },
  { path: '**', redirectTo: '' },
];

const perfRoutes: Routes = [
  {
    path: 'perf-fixture',
    loadComponent: () =>
      import('./perf-fixture/perf-fixture.component').then((m) => m.PerfFixtureComponent),
  },
];

// Perf fixture is opt-in via ?perf=1 so it never shows up in normal navigation.
// Inserted before the wildcard so it actually matches.
export const routes: Routes = isPerfMode() ? [...perfRoutes, ...baseRoutes] : baseRoutes;
