import { ChangeDetectionStrategy, Component, effect, viewChild } from '@angular/core';
import { EditorComponent, IWorkspaceFixture } from '@mocktail/editor';
import { IWireElement } from '@mocktail/projects';
import fixture from '../../../scripts/perf-baselines/fixture.json';

type PerfFixture = IWorkspaceFixture & { elements: readonly IWireElement[] };

/**
 * Routed perf-fixture host. Renders the real EditorComponent against a
 * static fixture so editor-perf-trace.mjs can drive it without touching
 * Firestore. Mounted at /perf-fixture and only registered when the URL
 * contains ?perf=1 (see app.routes.ts).
 */
@Component({
  selector: 'mk-perf-fixture',
  standalone: true,
  imports: [EditorComponent],
  template: `<mk-editor></mk-editor>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerfFixtureComponent {
  private readonly _editor = viewChild.required(EditorComponent);

  constructor() {
    effect(() => {
      this._editor().loadFixture(fixture as unknown as PerfFixture);
    });
  }
}
