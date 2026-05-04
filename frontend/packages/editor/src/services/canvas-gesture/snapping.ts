import { IWireElement } from '@mocktail/projects';

export type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface IGuideLine {
  orientation: 'v' | 'h';
  pos: number;
  start: number;
  end: number;
}

export interface ISnapContext {
  readonly elements: readonly IWireElement[];
  readonly pageW: number;
  readonly pageH: number;
  readonly gridColumns: readonly { left: number; width: number }[];
  readonly snapEnabled: boolean;
}

export interface IMoveResult {
  readonly id: string;
  readonly patch: Partial<IWireElement>;
  readonly guides: readonly IGuideLine[];
}

export const GUIDE_THRESHOLD = 4;

export function snapToGuides(
  rawX: number,
  rawY: number,
  w: number,
  h: number,
  selfId: string,
  ctx: ISnapContext,
): { x: number; y: number; guides: IGuideLine[] } {
  const siblings = ctx.elements.filter((e) => e.id !== selfId && !e.rotation);
  const vTargets: { v: number; src: { y0: number; y1: number } }[] = [];
  const hTargets: { v: number; src: { x0: number; x1: number } }[] = [];
  for (const s of siblings) {
    const bx = { y0: s.y, y1: s.y + s.h };
    vTargets.push({ v: s.x, src: bx });
    vTargets.push({ v: s.x + s.w / 2, src: bx });
    vTargets.push({ v: s.x + s.w, src: bx });
    const by = { x0: s.x, x1: s.x + s.w };
    hTargets.push({ v: s.y, src: by });
    hTargets.push({ v: s.y + s.h / 2, src: by });
    hTargets.push({ v: s.y + s.h, src: by });
  }
  vTargets.push({ v: 0, src: { y0: 0, y1: ctx.pageH } });
  vTargets.push({ v: ctx.pageW / 2, src: { y0: 0, y1: ctx.pageH } });
  vTargets.push({ v: ctx.pageW, src: { y0: 0, y1: ctx.pageH } });
  hTargets.push({ v: 0, src: { x0: 0, x1: ctx.pageW } });
  hTargets.push({ v: ctx.pageH / 2, src: { x0: 0, x1: ctx.pageW } });
  hTargets.push({ v: ctx.pageH, src: { x0: 0, x1: ctx.pageW } });

  if (ctx.snapEnabled) {
    for (const col of ctx.gridColumns) {
      vTargets.push({ v: col.left, src: { y0: 0, y1: ctx.pageH } });
      vTargets.push({ v: col.left + col.width, src: { y0: 0, y1: ctx.pageH } });
    }
  }

  const candidatesX = [{ offset: 0 }, { offset: w / 2 }, { offset: w }];
  const candidatesY = [{ offset: 0 }, { offset: h / 2 }, { offset: h }];

  let bestX: { delta: number; snapped: number; guide: IGuideLine } | null = null;
  let bestY: { delta: number; snapped: number; guide: IGuideLine } | null = null;

  for (const cand of candidatesX) {
    const edge = rawX + cand.offset;
    for (const t of vTargets) {
      const d = Math.abs(edge - t.v);
      if (d <= GUIDE_THRESHOLD && (!bestX || d < bestX.delta)) {
        bestX = {
          delta: d,
          snapped: t.v - cand.offset,
          guide: {
            orientation: 'v',
            pos: t.v,
            start: Math.min(rawY, t.src.y0),
            end: Math.max(rawY + h, t.src.y1),
          },
        };
      }
    }
  }
  for (const cand of candidatesY) {
    const edge = rawY + cand.offset;
    for (const t of hTargets) {
      const d = Math.abs(edge - t.v);
      if (d <= GUIDE_THRESHOLD && (!bestY || d < bestY.delta)) {
        bestY = {
          delta: d,
          snapped: t.v - cand.offset,
          guide: {
            orientation: 'h',
            pos: t.v,
            start: Math.min(rawX, t.src.x0),
            end: Math.max(rawX + w, t.src.x1),
          },
        };
      }
    }
  }

  const guides: IGuideLine[] = [];
  if (bestX) guides.push(bestX.guide);
  if (bestY) guides.push(bestY.guide);
  return {
    x: bestX ? Math.round(bestX.snapped) : rawX,
    y: bestY ? Math.round(bestY.snapped) : rawY,
    guides,
  };
}

export function snapResizeEdges(
  rect: { x: number; y: number; w: number; h: number },
  dir: HandleDir,
  selfId: string,
  ctx: ISnapContext,
): { x: number; y: number; w: number; h: number; guides: IGuideLine[] } {
  const siblings = ctx.elements.filter((e) => e.id !== selfId && !e.rotation);
  const vTargets: { v: number; src: { y0: number; y1: number } }[] = [];
  const hTargets: { v: number; src: { x0: number; x1: number } }[] = [];
  for (const s of siblings) {
    const by = { y0: s.y, y1: s.y + s.h };
    vTargets.push({ v: s.x, src: by });
    vTargets.push({ v: s.x + s.w / 2, src: by });
    vTargets.push({ v: s.x + s.w, src: by });
    const bx = { x0: s.x, x1: s.x + s.w };
    hTargets.push({ v: s.y, src: bx });
    hTargets.push({ v: s.y + s.h / 2, src: bx });
    hTargets.push({ v: s.y + s.h, src: bx });
  }
  vTargets.push({ v: 0, src: { y0: 0, y1: ctx.pageH } });
  vTargets.push({ v: ctx.pageW / 2, src: { y0: 0, y1: ctx.pageH } });
  vTargets.push({ v: ctx.pageW, src: { y0: 0, y1: ctx.pageH } });
  hTargets.push({ v: 0, src: { x0: 0, x1: ctx.pageW } });
  hTargets.push({ v: ctx.pageH / 2, src: { x0: 0, x1: ctx.pageW } });
  hTargets.push({ v: ctx.pageH, src: { x0: 0, x1: ctx.pageW } });
  if (ctx.snapEnabled) {
    for (const col of ctx.gridColumns) {
      vTargets.push({ v: col.left, src: { y0: 0, y1: ctx.pageH } });
      vTargets.push({ v: col.left + col.width, src: { y0: 0, y1: ctx.pageH } });
    }
  }

  let { x, y, w, h } = rect;
  const guides: IGuideLine[] = [];

  const snapV = (edge: number): { v: number; guide: IGuideLine } | null => {
    let best: { delta: number; v: number; src: { y0: number; y1: number } } | null = null;
    for (const t of vTargets) {
      const d = Math.abs(edge - t.v);
      if (d <= GUIDE_THRESHOLD && (!best || d < best.delta)) {
        best = { delta: d, v: t.v, src: t.src };
      }
    }
    if (!best) return null;
    return {
      v: best.v,
      guide: {
        orientation: 'v',
        pos: best.v,
        start: Math.min(y, best.src.y0),
        end: Math.max(y + h, best.src.y1),
      },
    };
  };
  const snapH = (edge: number): { v: number; guide: IGuideLine } | null => {
    let best: { delta: number; v: number; src: { x0: number; x1: number } } | null = null;
    for (const t of hTargets) {
      const d = Math.abs(edge - t.v);
      if (d <= GUIDE_THRESHOLD && (!best || d < best.delta)) {
        best = { delta: d, v: t.v, src: t.src };
      }
    }
    if (!best) return null;
    return {
      v: best.v,
      guide: {
        orientation: 'h',
        pos: best.v,
        start: Math.min(x, best.src.x0),
        end: Math.max(x + w, best.src.x1),
      },
    };
  };

  if (dir.includes('e')) {
    const s = snapV(x + w);
    if (s) {
      w = s.v - x;
      guides.push(s.guide);
    }
  }
  if (dir.includes('w')) {
    const right = x + w;
    const s = snapV(x);
    if (s) {
      x = s.v;
      w = right - x;
      guides.push(s.guide);
    }
  }
  if (dir.includes('s')) {
    const s = snapH(y + h);
    if (s) {
      h = s.v - y;
      guides.push(s.guide);
    }
  }
  if (dir.includes('n')) {
    const bottom = y + h;
    const s = snapH(y);
    if (s) {
      y = s.v;
      h = bottom - y;
      guides.push(s.guide);
    }
  }

  return { x, y, w, h, guides };
}
