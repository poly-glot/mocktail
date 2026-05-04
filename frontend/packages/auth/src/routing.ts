import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'invite/:token',
    loadComponent: () =>
      import('./components/invite-accept/invite-accept.component').then(
        (m) => m.InviteAcceptComponent,
      ),
  },
];
