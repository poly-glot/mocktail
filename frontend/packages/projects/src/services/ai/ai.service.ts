import { Injectable, signal } from '@angular/core';
import { IWireElement } from '../../interfaces/project.interface';

export interface IAiGenerated {
  elements: Partial<IWireElement>[];
  notes?: string;
  source?: 'gemini' | 'fallback';
  model?: string;
}

export interface IAiReviewIssue {
  severity: 'info' | 'warn' | 'error';
  message: string;
  elementId?: string;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  public readonly busy = signal(false);
  public readonly lastNotes = signal<string | null>(null);
  public readonly lastSource = signal<string | null>(null);

  public async generate(prompt: string, existing?: IWireElement[]): Promise<IAiGenerated> {
    this.busy.set(true);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, existing: existing ?? [] }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`AI error ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as IAiGenerated;
      this.lastNotes.set(data.notes ?? null);
      this.lastSource.set(data.source ?? 'fallback');
      return data;
    } finally {
      this.busy.set(false);
    }
  }

  public async review(elements: IWireElement[]): Promise<IAiReviewIssue[]> {
    const res = await fetch('/api/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements }),
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ issues: [] }));
    return (data.issues ?? []) as IAiReviewIssue[];
  }
}
