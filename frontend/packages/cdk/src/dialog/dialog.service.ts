import { Injectable, signal } from '@angular/core';
import { AlertOptions, ConfirmOptions, DialogConfig, PromptOptions } from './dialog.types';

interface PendingDialog {
  config: DialogConfig;
  resolve: (value: string | boolean | null) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  public readonly queue = signal<PendingDialog[]>([]);

  public alert(opts: AlertOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      this._push({
        config: {
          id: this._id(),
          kind: 'alert',
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? 'OK',
        },
        resolve: () => resolve(),
      });
    });
  }

  public confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._push({
        config: {
          id: this._id(),
          kind: 'confirm',
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? 'Confirm',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
          destructive: opts.destructive ?? false,
        },
        resolve: (v) => resolve(v === true),
      });
    });
  }

  public prompt(opts: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this._push({
        config: {
          id: this._id(),
          kind: 'prompt',
          title: opts.title,
          message: opts.message,
          inputLabel: opts.inputLabel,
          inputValue: opts.inputValue ?? '',
          inputPlaceholder: opts.inputPlaceholder,
          confirmLabel: opts.confirmLabel ?? 'Save',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
          validate: opts.validate,
        },
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      });
    });
  }

  public resolveTop(value: string | boolean | null): void {
    const current = this.queue();
    if (current.length === 0) return;
    const top = current[current.length - 1];
    this.queue.set(current.slice(0, -1));
    top.resolve(value);
  }

  public cancelTop(): void {
    this.resolveTop(null);
  }

  private _push(dialog: PendingDialog): void {
    this.queue.update((q) => [...q, dialog]);
  }

  private _id(): string {
    return `dlg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
