import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/editor/editor.component').then((m) => m.EditorComponent),
  },
];
