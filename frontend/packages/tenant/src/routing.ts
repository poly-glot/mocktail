import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'members',
    loadComponent: () =>
      import('./components/members/members.component').then((m) => m.MembersComponent),
  },
];
