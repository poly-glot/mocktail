import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogService } from './dialog.service';
import { DialogConfig, PromptConfig } from './dialog.types';

@Component({
  selector: 'mk-dialog-host',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dialog-host.component.html',
  styleUrl: './dialog-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-open]': 'hasOpen() ? "true" : null',
  },
})
export class DialogHostComponent implements AfterViewInit, OnDestroy {
  @ViewChild('card') public cardRef?: ElementRef<HTMLDivElement>;
  @ViewChild('promptInput') public promptInputRef?: ElementRef<HTMLInputElement>;

  public readonly dialog = inject(DialogService);
  public readonly queue = this.dialog.queue;
  public readonly top = computed<DialogConfig | null>(() => {
    const q = this.queue();
    return q.length > 0 ? q[q.length - 1].config : null;
  });
  public readonly hasOpen = computed(() => this.top() !== null);

  public readonly inputValue = signal('');
  public readonly inputError = signal<string | null>(null);

  private _lastFocused: HTMLElement | null = null;
  private _currentId: string | null = null;

  constructor() {
    effect(() => {
      const t = this.top();
      if (t && t.id !== this._currentId) {
        this._currentId = t.id;
        this._lastFocused = (document.activeElement as HTMLElement) ?? null;
        this.inputError.set(null);
        if (t.kind === 'prompt') {
          this.inputValue.set((t as PromptConfig).inputValue ?? '');
        }
        document.body.style.overflow = 'hidden';
        queueMicrotask(() => this._focusInitial());
      } else if (!t && this._currentId !== null) {
        this._currentId = null;
        document.body.style.overflow = '';
        this._restoreFocus();
      }
    });
  }

  public ngAfterViewInit(): void {
    if (this.top()) this._focusInitial();
  }

  public ngOnDestroy(): void {
    document.body.style.overflow = '';
  }

  public isPrompt(cfg: DialogConfig): cfg is PromptConfig {
    return cfg.kind === 'prompt';
  }

  public onBackdrop(): void {
    const t = this.top();
    if (!t) return;
    if (t.kind === 'alert') {
      this.onConfirm();
    } else {
      this.dialog.cancelTop();
    }
  }

  public onConfirm(): void {
    const t = this.top();
    if (!t) return;
    if (t.kind === 'prompt') {
      const raw = this.inputValue().trim();
      const validator = (t as PromptConfig).validate;
      const err = validator ? validator(raw) : raw.length === 0 ? 'Required' : null;
      if (err) {
        this.inputError.set(err);
        this.promptInputRef?.nativeElement.focus();
        return;
      }
      this.dialog.resolveTop(raw);
    } else if (t.kind === 'confirm') {
      this.dialog.resolveTop(true);
    } else {
      this.dialog.resolveTop(null);
    }
  }

  public onCancel(): void {
    this.dialog.cancelTop();
  }

  public onInputChange(v: string): void {
    this.inputValue.set(v);
    if (this.inputError()) this.inputError.set(null);
  }

  public onFormSubmit(event: Event): void {
    event.preventDefault();
    this.onConfirm();
  }

  // Angular 21 template type-checker narrows $event for keydown.<key> bindings
  // to Event, not KeyboardEvent — runtime is still a KeyboardEvent. Param widened
  // to Event to satisfy the checker; cast applied where keyboard fields are read.
  @HostListener('document:keydown.escape', ['$event'])
  public onEscape(event: Event): void {
    if (!this.hasOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    const t = this.top();
    if (!t) return;
    if (t.kind === 'alert') this.onConfirm();
    else this.onCancel();
  }

  @HostListener('document:keydown.tab', ['$event'])
  public onTab(event: Event): void {
    if (!this.hasOpen()) return;
    const card = this.cardRef?.nativeElement;
    if (!card) return;
    const focusables = card.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const ke = event as KeyboardEvent;
    if (ke.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!ke.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private _focusInitial(): void {
    const t = this.top();
    if (!t) return;
    if (t.kind === 'prompt' && this.promptInputRef?.nativeElement) {
      const input = this.promptInputRef.nativeElement;
      input.focus();
      input.select();
      return;
    }
    const card = this.cardRef?.nativeElement;
    if (!card) return;
    const primary = card.querySelector<HTMLButtonElement>('button[data-primary]');
    primary?.focus();
  }

  private _restoreFocus(): void {
    const target = this._lastFocused;
    this._lastFocused = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      target.focus();
    }
  }
}
