import { Injectable, computed, signal } from '@angular/core';

export interface IMarqueeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

@Injectable({ providedIn: 'root' })
export class EditorSelectionService {
  public readonly selectedId = signal<string | null>(null);
  public readonly extraSelectedIds = signal<ReadonlySet<string>>(new Set());
  public readonly marqueeRect = signal<IMarqueeRect | null>(null);

  public readonly allSelectedIdSet = computed<ReadonlySet<string>>(() => {
    const extras = this.extraSelectedIds();
    const primary = this.selectedId();
    if (!primary) return extras;
    if (extras.has(primary)) return extras;
    const merged = new Set<string>(extras);
    merged.add(primary);
    return merged;
  });
  public readonly selectionCount = computed(() => this.allSelectedIdSet().size);

  public isSelected(id: string): boolean {
    return this.allSelectedIdSet().has(id);
  }

  public clear(): void {
    this.selectedId.set(null);
    this.extraSelectedIds.set(new Set());
  }

  public setPrimary(id: string | null): void {
    this.selectedId.set(id);
  }

  public setExtras(extras: ReadonlySet<string>): void {
    this.extraSelectedIds.set(extras);
  }

  public setSelection(primary: string | null, extras: ReadonlySet<string>): void {
    this.selectedId.set(primary);
    this.extraSelectedIds.set(extras);
  }

  public setMarquee(rect: IMarqueeRect | null): void {
    this.marqueeRect.set(rect);
  }

  public toggleInSelection(
    id: string,
    onPrimaryChanged?: (newPrimary: string | null) => void,
  ): void {
    const primary = this.selectedId();
    const extras = new Set(this.extraSelectedIds());

    if (primary === id) {
      const iter = extras.values().next();
      const promoted = iter.done ? null : (iter.value as string);
      if (promoted === null) {
        this.selectedId.set(null);
        this.extraSelectedIds.set(new Set());
        onPrimaryChanged?.(null);
      } else {
        extras.delete(promoted);
        this.selectedId.set(promoted);
        this.extraSelectedIds.set(extras);
        onPrimaryChanged?.(promoted);
      }
      return;
    }

    if (extras.has(id)) {
      extras.delete(id);
      this.extraSelectedIds.set(extras);
      return;
    }

    if (primary === null) {
      this.selectedId.set(id);
      onPrimaryChanged?.(id);
      return;
    }
    extras.add(id);
    this.extraSelectedIds.set(extras);
  }
}
