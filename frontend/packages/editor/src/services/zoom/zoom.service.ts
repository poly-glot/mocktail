import { Injectable, signal } from '@angular/core';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const STEP = 0.1;
const DEFAULT_ZOOM = 0.9;

function clamp(n: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(n * 100) / 100));
}

@Injectable({ providedIn: 'root' })
export class EditorZoomService {
  public readonly zoom = signal(DEFAULT_ZOOM);
  public readonly autoFitZoom = signal(true);

  public zoomIn(): void {
    this.autoFitZoom.set(false);
    this.zoom.update((z) => clamp(z + STEP));
  }

  public zoomOut(): void {
    this.autoFitZoom.set(false);
    this.zoom.update((z) => clamp(z - STEP));
  }

  public toggleAutoFit(): void {
    this.autoFitZoom.update((v) => !v);
  }

  public setFromAutoFit(value: number): void {
    const rounded = clamp(value);
    if (this.zoom() !== rounded) this.zoom.set(rounded);
  }

  public zoomPct(): string {
    return Math.round(this.zoom() * 100) + '%';
  }
}
