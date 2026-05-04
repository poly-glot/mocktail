import { Injectable, inject } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { AiService, ElementType, IWireElement, ProjectApiService } from '@mocktail/projects';
import { EditorElementFactoryService } from '../element-factory/element-factory.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';

/**
 * Orchestrates the "generate from AI prompt" flow that used to live inline on
 * EditorComponent.onAiSubmit. Validates the prompt/pageId pair, asks the AI
 * service for element stubs, normalises them into full IWireElement shapes
 * (carrying the same defaults the original handler applied), then routes
 * append/replace writes through the Zig collab proxy.
 *
 * Errors bubble up so the component can own its own dialog/logging policy.
 */
@Injectable({ providedIn: 'root' })
export class EditorAiOrchestratorService {
  private readonly _ai = inject(AiService);
  private readonly _projects = inject(ProjectApiService);
  private readonly _factory = inject(EditorElementFactoryService);
  private readonly _collab = inject(CollabService);
  private readonly _state = inject(EditorElementsStateService);

  public async generate(args: {
    prompt: string;
    tid: string;
    pid: string;
    pageId: string;
    existing: readonly IWireElement[];
    baseZIndex: number;
  }): Promise<{ added: number } | null> {
    const prompt = args.prompt.trim();
    if (!prompt || !args.pageId) return null;

    const { tid, pid, pageId, existing, baseZIndex } = args;
    const existingIds = existing.map((e) => e.id);
    const out = await this._ai.generate(prompt, existing as IWireElement[]);
    const append = !/^\s*(replace|reset)/i.test(prompt);
    const toWrite: IWireElement[] = [];
    let offset = 0;
    for (const raw of out.elements ?? []) {
      const id = this._factory.genId();
      const props = ((raw as { props?: Record<string, unknown> }).props ?? {}) as Record<
        string,
        unknown
      >;
      toWrite.push({
        id,
        pageId,
        type: (raw.type ?? 'rect') as ElementType,
        x: Math.round((raw.x ?? 40) + offset),
        y: Math.round((raw.y ?? 40) + offset),
        w: Math.round(raw.w ?? 200),
        h: Math.round(raw.h ?? 40),
        zIndex: baseZIndex + offset,
        text: (raw.text ?? props['text'] ?? props['placeholder']) as string | undefined,
        variant: (raw.variant ?? props['variant']) as string | undefined,
        data: (raw.data ?? props) as Record<string, unknown>,
      });
      offset += 1;
    }

    // Replace semantics: delete every existing id for this page first, then
    // add the new batch. The proxy already resolves the edge-case ordering
    // if a client later edits a just-deleted id (the delete is dropped).
    if (!append) {
      this._state.list.update((els) => els.filter((e) => !existingIds.includes(e.id)));
      for (const id of existingIds) this._collab.sendDelete(id);
    }
    this._state.list.update((els) => [...els, ...toWrite]);
    for (const el of toWrite) {
      this._collab.sendEdit(el.id, this._asPatch(el));
    }
    this._collab.flushPendingEdits();

    const count = out.elements?.length ?? 0;
    await this._projects.writeActivity(
      tid,
      pid,
      'ai-generated',
      `AI generated ${count} elements for "${prompt.slice(0, 40)}"`,
    );
    return { added: count };
  }

  private _asPatch(el: IWireElement): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
}
