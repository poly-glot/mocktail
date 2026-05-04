import { Injectable, inject } from '@angular/core';
import {
  ActivityType,
  IActivity,
  IComment,
  IGridConfig,
  IPageDoc,
  IProject,
  IWireElement,
} from '../../interfaces/project.interface';
import { ActivityRepository } from '../../repositories/activity.repository';
import { CommentsRepository } from '../../repositories/comments.repository';
import { ElementsRepository } from '../../repositories/elements.repository';
import { GridConfigRepository } from '../../repositories/grid-config.repository';
import { PagesRepository } from '../../repositories/pages.repository';
import { ProjectsRepository } from '../../repositories/projects.repository';

/**
 * Backward-compat facade for the per-aggregate repositories. New code should
 * inject the specific repository (ProjectsRepository, PagesRepository, etc.)
 * directly. This service exists so existing consumers (editor services, the
 * dashboard, the collab proxy) continue to work without a sweeping migration.
 */
@Injectable({ providedIn: 'root' })
export class ProjectApiService {
  private readonly _projects = inject(ProjectsRepository);
  private readonly _pages = inject(PagesRepository);
  private readonly _elements = inject(ElementsRepository);
  private readonly _comments = inject(CommentsRepository);
  private readonly _activity = inject(ActivityRepository);
  private readonly _grid = inject(GridConfigRepository);

  public subscribeProjects(tid: string, onChange: (projects: IProject[]) => void): () => void {
    return this._projects.subscribeProjects(tid, onChange);
  }

  public createProject(tid: string, name: string): Promise<string> {
    return this._projects.createProject(tid, name);
  }

  public renameProject(tid: string, pid: string, name: string): Promise<void> {
    return this._projects.renameProject(tid, pid, name);
  }

  public softDeleteProject(tid: string, pid: string): Promise<void> {
    return this._projects.softDeleteProject(tid, pid);
  }

  public subscribePages(
    tid: string,
    pid: string,
    onChange: (pages: IPageDoc[]) => void,
  ): () => void {
    return this._pages.subscribePages(tid, pid, onChange);
  }

  public addPage(tid: string, pid: string, name: string, order: number): Promise<string> {
    return this._pages.addPage(tid, pid, name, order);
  }

  public deletePage(tid: string, pid: string, pageId: string): Promise<void> {
    return this._pages.deletePage(tid, pid, pageId);
  }

  public subscribeElements(
    tid: string,
    pid: string,
    pageId: string,
    onChange: (els: IWireElement[], meta: { hasPendingWrites: boolean }) => void,
  ): () => void {
    return this._elements.subscribeElements(tid, pid, pageId, onChange);
  }

  public patchElements(
    tid: string,
    pid: string,
    patches: readonly { id: string; patch: Partial<IWireElement> }[],
  ): Promise<void> {
    return this._elements.patchElements(tid, pid, patches);
  }

  public subscribeProjectDoc(
    tid: string,
    pid: string,
    onChange: (proj: IProject | null) => void,
  ): () => void {
    return this._projects.subscribeProjectDoc(tid, pid, onChange);
  }

  public updateGridConfig(tid: string, pid: string, gridConfig: IGridConfig): Promise<void> {
    return this._grid.updateGridConfig(tid, pid, gridConfig);
  }

  public upsertElement(
    tid: string,
    pid: string,
    el: IWireElement,
    opts?: { deleteFields?: readonly (keyof IWireElement)[] },
  ): Promise<void> {
    return this._elements.upsertElement(tid, pid, el, opts);
  }

  public deleteElement(tid: string, pid: string, elId: string): Promise<void> {
    return this._elements.deleteElement(tid, pid, elId);
  }

  public replaceElements(
    tid: string,
    pid: string,
    toDelete: string[],
    toWrite: IWireElement[],
  ): Promise<void> {
    return this._elements.replaceElements(tid, pid, toDelete, toWrite);
  }

  public addElements(tid: string, pid: string, toWrite: IWireElement[]): Promise<void> {
    return this._elements.addElements(tid, pid, toWrite);
  }

  public subscribeComments(
    tid: string,
    pid: string,
    onChange: (comments: IComment[]) => void,
    pageId?: string,
  ): () => void {
    return this._comments.subscribeComments(tid, pid, onChange, pageId);
  }

  public addComment(
    tid: string,
    pid: string,
    comment: Omit<IComment, 'id' | 'createdAt' | 'resolved' | 'authorId' | 'authorName'>,
  ): Promise<string> {
    return this._comments.addComment(tid, pid, comment);
  }

  public resolveComment(tid: string, pid: string, cid: string, resolved = true): Promise<void> {
    return this._comments.resolveComment(tid, pid, cid, resolved);
  }

  public writeActivity(
    tid: string,
    pid: string,
    type: ActivityType,
    summary: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    return this._activity.writeActivity(tid, pid, type, summary, extra);
  }

  public subscribeTenantActivity(
    tid: string,
    max: number,
    onChange: (rows: IActivity[]) => void,
  ): () => void {
    return this._activity.subscribeTenantActivity(tid, max, onChange);
  }

  public subscribeActivity(
    tid: string,
    pid: string,
    max: number,
    onChange: (rows: IActivity[]) => void,
  ): () => void {
    return this._activity.subscribeActivity(tid, pid, max, onChange);
  }
}
