import { Routes } from '@angular/router';
import { authGuard } from '@mocktail/auth';
import { tenantGuard } from '@mocktail/tenant';

export const routes: Routes = [
  {
    path: 't/:tid',
    loadComponent: () => import('./components/shell/shell.component').then((m) => m.ShellComponent),
    canActivate: [authGuard, tenantGuard],
    children: [
      {
        path: '',
        loadChildren: () => import('@mocktail/projects/routing').then((m) => m.routes),
      },
      {
        path: 'settings',
        loadChildren: () => import('@mocktail/tenant/routing').then((m) => m.routes),
      },
      {
        path: 'p/:pid',
        loadChildren: () => import('@mocktail/editor/routing').then((m) => m.routes),
      },
    ],
  },
  {
    path: '',
    loadComponent: () =>
      import('./components/landing/landing.component').then((m) => m.LandingComponent),
  },
];
