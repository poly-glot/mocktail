import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { IWireElement, imageRefOf } from '@mocktail/projects';
import { EditorInspectorService } from '../../services/inspector/inspector.service';
import { EditorSessionService } from '../../services/session/session.service';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-image',
  standalone: true,
  template: `
    @if (imageRefOf(el()); as img) {
      <img
        class="image-src"
        [src]="img.src"
        [alt]="'Photo by ' + img.photographer + ' on Unsplash'"
        draggable="false"
        loading="lazy"
        decoding="async"
        (error)="onLoadError()"
        [attr.data-testid]="'image-src-' + el().id"
      />
    } @else {
      <div class="image-stub">
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          stroke="currentColor"
          fill="none"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5-10 10" />
        </svg>
      </div>
    }
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElImageComponent {
  public readonly el = input.required<IWireElement>();

  private readonly _insp = inject(EditorInspectorService);
  private readonly _session = inject(EditorSessionService);

  public imageRefOf = imageRefOf;

  public onLoadError(): void {
    void this._insp
      .removeImage(this._session.tid(), this._session.pid(), this.el().id)
      .catch(() => undefined);
  }
}
