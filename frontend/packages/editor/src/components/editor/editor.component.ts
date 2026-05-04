import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CollabService, ICursorState } from '@mocktail/collab';
import {
  AiService,
  ElementType,
  IWireElement,
  ProjectApiService,
  buttonVariantOf as buttonVariantOfFn,
  dividerOrientation as dividerOrientationFn,
  dividerStyleOf as dividerStyleOfFn,
  hasBackground as hasBackgroundFn,
  hasBorder as hasBorderFn,
  hasFontSize as hasFontSizeFn,
  hasRichText as hasRichTextFn,
  hasTextField as hasTextFieldFn,
  isCheckedOf as isCheckedOfFn,
  isTextual as isTextualFn,
} from '@mocktail/projects';
import { DialogService } from '@mocktail/cdk';
import { CanvasGestureStore, HandleDir } from '../../services/canvas-gesture/canvas-gesture.store';
import { EditorAiOrchestratorService } from '../../services/ai-orchestrator/ai-orchestrator.service';
import { EditorClipboardService } from '../../services/clipboard/clipboard.service';
import { EditorCollabSyncService } from '../../services/collab-sync/collab-sync.service';
import { CommentsStore } from '../../services/comments/comments.store';
import { ImageLibraryService } from '../../services/image-library/image-library.service';
import { IWorkspaceFixture, WorkspaceStore } from '../../services/workspace/workspace.store';
import { EditorLayerOrderService } from '../../services/layer-order/layer-order.service';
import { EditorCommentsService } from '../../services/comments/comments.service';
import { EditorContextMenuService } from '../../services/context-menu/context-menu.service';
import { EditorElementEditorService } from '../../services/element-editor/element-editor.service';
import { EditorElementFactoryService } from '../../services/element-factory/element-factory.service';
import { EditorElementsStateService } from '../../services/elements-state/elements-state.service';
import { EditorInlineEditService } from '../../services/inline-edit/inline-edit.service';
import { EditorPanelsService } from '../../services/panels/panels.service';
import { EditorSelectionService } from '../../services/selection/selection.service';
import { EditorSessionService } from '../../services/session/session.service';
import { EditorViewportService } from '../../services/viewport/viewport.service';
import { EditorZoomService } from '../../services/zoom/zoom.service';
import { FontLoaderService } from '../../services/font-loader/font-loader.service';
import {
  EditorShortcutsDirective,
  IEditorShortcutsApi,
} from '../../directives/editor-shortcuts/editor-shortcuts.directive';
import { ElBarChartComponent } from '../canvas-elements/el-bar-chart.component';
import { ElButtonComponent } from '../canvas-elements/el-button.component';
import { ElCardComponent } from '../canvas-elements/el-card.component';
import { ElCheckboxComponent } from '../canvas-elements/el-checkbox.component';
import { ElDividerComponent } from '../canvas-elements/el-divider.component';
import { ElDonutComponent } from '../canvas-elements/el-donut.component';
import { ElHeadingComponent } from '../canvas-elements/el-heading.component';
import { ElIconComponent } from '../canvas-elements/el-icon.component';
import { ElImageComponent } from '../canvas-elements/el-image.component';
import { ElLinkComponent } from '../canvas-elements/el-link.component';
import { ElListComponent } from '../canvas-elements/el-list.component';
import { ElPhoneFrameComponent } from '../canvas-elements/el-phone-frame.component';
import { ElTableComponent } from '../canvas-elements/el-table.component';
import { ElTagComponent } from '../canvas-elements/el-tag.component';
import { ElTextComponent } from '../canvas-elements/el-text.component';
import { ElToggleComponent } from '../canvas-elements/el-toggle.component';
import { BorderStylePipe } from '../../pipes/border-style.pipe';
import { FontSizePxPipe } from '../../pipes/font-size-px.pipe';
import { HeadingFontSizePipe } from '../../pipes/heading-font-size.pipe';
import { PeerInitialsPipe } from '../../pipes/peer-initials.pipe';
import { TransformForPipe } from '../../pipes/transform-for.pipe';
import { GridOverlayComponent, computeColumnRegions } from '../grid-overlay/grid-overlay.component';
import { ImageLibraryPanelComponent } from '../image-library-panel/image-library-panel.component';
import { IPaletteItem, PALETTES, PaletteComponent } from '../palette/palette.component';
import { IReorderEvent, LayersPanelComponent } from '../layers-panel/layers-panel.component';
import { InspectorPanelComponent } from '../inspector-panel/inspector-panel.component';
import {
  BarChart3,
  CheckSquare,
  Component as ComponentIcon,
  Columns3,
  FileText,
  GripVertical,
  Heading1,
  Image,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link as LinkIcon,
  Lock,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  Menu,
  MessageSquare,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PieChart,
  RotateCw,
  Search,
  Smartphone,
  Sparkles,
  Square,
  Table,
  Tag,
  TextCursorInput,
  ToggleRight,
  Trash2,
  Type,
  Unlock,
  Users,
  X,
} from 'lucide-angular';

import { ICON_PROVIDER_MAP } from '../icon-picker/icon-registry';

/* HandleDir and IGuideLine are now provided by CanvasGestureStore */
/* IPalette, IPaletteItem, PALETTES are now provided by PaletteComponent */

@Component({
  selector: 'mk-editor',
  standalone: true,
  imports: [
    FormsModule,
    LucideAngularModule,
    GridOverlayComponent,
    PaletteComponent,
    LayersPanelComponent,
    ImageLibraryPanelComponent,
    InspectorPanelComponent,
    EditorShortcutsDirective,
    ElBarChartComponent,
    ElButtonComponent,
    ElCardComponent,
    ElCheckboxComponent,
    ElDividerComponent,
    ElDonutComponent,
    ElHeadingComponent,
    ElIconComponent,
    ElImageComponent,
    ElLinkComponent,
    ElListComponent,
    ElPhoneFrameComponent,
    ElTableComponent,
    ElTagComponent,
    ElTextComponent,
    ElToggleComponent,
    BorderStylePipe,
    FontSizePxPipe,
    HeadingFontSizePipe,
    PeerInitialsPipe,
    TransformForPipe,
  ],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        BarChart3,
        CheckSquare,
        Columns3,
        Component: ComponentIcon,
        FileText,
        GripVertical,
        Heading1,
        Image,
        Layers,
        LayoutGrid,
        LayoutTemplate,
        Link: LinkIcon,
        Lock,
        Menu,
        MessageSquare,
        Minus,
        MousePointer2,
        PanelLeftClose,
        PanelLeftOpen,
        PanelRightClose,
        PanelRightOpen,
        PieChart,
        RotateCw,
        Search,
        Smartphone,
        Sparkles,
        Square,
        Table,
        Tag,
        TextCursorInput,
        ToggleRight,
        Trash2,
        Type,
        Unlock,
        Users,
        X,
        ...ICON_PROVIDER_MAP,
      }),
    },
    // Editor-scoped services. Provided here (not providedIn:'root') so they
    // share EditorComponent's lifetime AND inject the leaf ActivatedRoute.
    WorkspaceStore,
    CommentsStore,
    EditorSessionService,
    EditorViewportService,
    CanvasGestureStore,
    ImageLibraryService,
    EditorCollabSyncService,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorComponent implements OnInit {
  public readonly palettes = PALETTES;
  public readonly tool = signal<'select' | 'hand'>('select');
  public readonly aiPrompt = signal('');

  private readonly _projects = inject(ProjectApiService);
  private readonly _collab = inject(CollabService);
  private readonly _ai = inject(AiService);
  private readonly _dialog = inject(DialogService);
  private readonly _gesture = inject(CanvasGestureStore);
  private readonly _panels = inject(EditorPanelsService);
  private readonly _zoomSvc = inject(EditorZoomService);
  private readonly _clipboard = inject(EditorClipboardService);
  private readonly _ctxMenu = inject(EditorContextMenuService);
  private readonly _cmts = inject(EditorCommentsService);
  private readonly _sel = inject(EditorSelectionService);
  private readonly _inline = inject(EditorInlineEditService);
  private readonly _elsState = inject(EditorElementsStateService);
  private readonly _editor = inject(EditorElementEditorService);
  private readonly _collabSync = inject(EditorCollabSyncService);
  private readonly _layerOrder = inject(EditorLayerOrderService);
  private readonly _session = inject(EditorSessionService);
  private readonly _viewport = inject(EditorViewportService);
  private readonly _factory = inject(EditorElementFactoryService);
  private readonly _ai_orch = inject(EditorAiOrchestratorService);
  private readonly _fonts = inject(FontLoaderService);
  private readonly _workspace = inject(WorkspaceStore);
  public readonly tid = this._session.tid;
  public readonly pid = this._session.pid;
  public readonly pages = this._session.pages;
  public readonly activePageId = this._session.activePageId;
  public readonly comments = this._session.comments;
  public readonly gridConfig = this._session.gridConfig;
  public readonly activePage = this._session.activePage;
  public readonly openComments = this._session.openComments;
  public readonly pageComments = this._session.pageComments;
  public readonly elements = this._elsState.list;
  public readonly dragGuides = this._gesture.guides;
  public readonly contextMenu = this._ctxMenu.menu;
  public readonly commentMode = this._cmts.commentMode;
  public readonly draftComment = this._cmts.draft;
  public readonly openCommentId = this._cmts.openPinId;
  public readonly selectedId = this._sel.selectedId;
  public readonly extraSelectedIds = this._sel.extraSelectedIds;
  public readonly marqueeRect = this._sel.marqueeRect;
  public readonly allSelectedIdSet = this._sel.allSelectedIdSet;
  public readonly selectionCount = this._sel.selectionCount;
  public readonly editingId = this._inline.editingId;

  public readonly collapseLeft = this._panels.collapseLeft;
  public readonly collapseRight = this._panels.collapseRight;
  public readonly leftPanel = this._panels.leftPanel;
  public readonly zoom = this._zoomSvc.zoom;
  public readonly autoFitZoom = this._zoomSvc.autoFitZoom;

  public readonly selected = computed(
    () => this.elements().find((e) => e.id === this.selectedId()) ?? null,
  );
  public readonly selectedElements = computed<readonly IWireElement[]>(() => {
    const ids = this.allSelectedIdSet();
    if (ids.size === 0) return [];
    return this.elements().filter((e) => ids.has(e.id));
  });
  public readonly aiBusy = this._ai.busy;
  public readonly aiNotes = this._ai.lastNotes;
  public readonly aiSource = this._ai.lastSource;
  public readonly collabCursors = this._collab.cursors;
  public readonly collabConnected = this._collab.connected;

  public readonly peers = computed<ICursorState[]>(() =>
    Array.from(this._collab.cursors().values()),
  );
  public readonly peerCount = computed(() => this.peers().length);

  public readonly layers = computed<IWireElement[]>(() =>
    [...this.elements()].sort((a, b) => b.zIndex - a.zIndex),
  );
  public readonly canPaste = this._clipboard.canPaste;

  public readonly columnRegions = computed<{ left: number; width: number }[]>(() =>
    computeColumnRegions(this.gridConfig(), this.activePage()?.width ?? 1200),
  );

  public readonly canvasEl = viewChild<ElementRef<HTMLDivElement>>('canvasEl');
  public readonly boardEl = viewChild<ElementRef<HTMLDivElement>>('boardEl');

  private _pendingDropType: ElementType | null = null;

  constructor() {
    effect(() => {
      this._viewport.setCanvasEl(this.canvasEl()?.nativeElement ?? null);
    });
    effect(() => {
      this._viewport.setBoardEl(this.boardEl()?.nativeElement ?? null);
    });
    // EditorSessionService now self-inits from the leaf ActivatedRoute.
    // Mirror the page-change side-effect (drop in-flight palette drag) here
    // so we don't have to thread a callback through the session service.
    effect(() => {
      this.activePageId();
      this._pendingDropType = null;
    });
  }

  public ngOnInit(): void {
    this._fonts.ensureGoogleFonts();
  }

  /**
   * Test/perf-fixture-only entry point; bypasses Firestore. Hydrates the
   * editor's workspace + elements state directly so the canvas renders the
   * given fixture without any network round-trip. Production navigation
   * never reaches this method (see /perf-fixture route, gated by ?perf=1).
   */
  public loadFixture(fixture: IWorkspaceFixture & { elements: readonly IWireElement[] }): void {
    this._workspace.loadFixture(fixture);
    this._elsState.list.set([...fixture.elements]);
  }

  public setActivePage(pageId: string): void {
    this._session.setActivePage(pageId);
  }

  public addPage(): Promise<void> {
    return this._session.addPage();
  }

  public requestDeletePage(pageId: string, ev?: Event): Promise<void> {
    return this._session.requestDeletePage(pageId, ev);
  }

  public onPaletteDragStart(payload: { item: IPaletteItem; ev: DragEvent }): void {
    this._pendingDropType = payload.item.type;
  }

  public onPaletteDragEnd(): void {
    this._pendingDropType = null;
  }

  public async onPaletteClick(item: IPaletteItem): Promise<void> {
    const pageId = this.activePageId();
    if (!pageId) return;
    const center = this._viewport.viewportCenterOnBoard(item.w, item.h);
    const id = await this._factory.createFromPalette(
      item,
      center,
      pageId,
      this.tid(),
      this.pid(),
      this.elements(),
    );
    this.selectedId.set(id);
  }

  public onCanvasDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  }

  public async onCanvasDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    const fromTransfer = ev.dataTransfer?.getData('text/mocktail-element') ?? '';
    const raw = fromTransfer || this._pendingDropType;
    if (!raw) return;
    const type = raw as ElementType;
    const preset = PALETTES.flatMap((p) => p.items).find((i) => i.type === type);
    if (!preset) {
      this._pendingDropType = null;
      return;
    }
    const pageId = this.activePageId();
    if (!pageId) return;
    const boardRect = this.boardEl()?.nativeElement.getBoundingClientRect();
    const z = this.zoom();
    const page = this.activePage();
    const pageW = page?.width ?? 1200;
    const pageH = page?.height ?? 800;
    const px = boardRect ? (ev.clientX - boardRect.left) / z : ev.clientX / z;
    const py = boardRect ? (ev.clientY - boardRect.top) / z : ev.clientY / z;
    const id = await this._factory.createFromDrop({
      type,
      point: { x: px, y: py },
      pageW,
      pageH,
      pageId,
      tid: this.tid(),
      pid: this.pid(),
      elements: this.elements(),
    });
    this.selectedId.set(id);
    this._pendingDropType = null;
  }

  public onElementPointerDown(ev: PointerEvent, el: IWireElement): void {
    this._gesture.onElementPointerDown(ev, el);
  }

  public isSelected(id: string): boolean {
    return this._sel.isSelected(id);
  }

  public onHandlePointerDown(ev: PointerEvent, dir: HandleDir, el: IWireElement): void {
    this._gesture.onHandlePointerDown(ev, dir, el);
  }

  public onRotateHandlePointerDown(ev: PointerEvent, el: IWireElement): void {
    this._gesture.onRotateHandlePointerDown(ev, el);
  }

  public onCanvasPointerDown(ev?: PointerEvent): void {
    this._gesture.onCanvasPointerDown(ev);
  }

  public toggleCommentMode(): void {
    this._cmts.toggleMode();
  }

  public onDraftInput(value: string): void {
    this._cmts.updateDraftText(value);
  }

  public cancelDraft(): void {
    this._cmts.cancelDraft();
  }

  public saveDraft(): Promise<void> {
    return this._cmts.saveDraft(this.tid(), this.pid(), this.activePageId());
  }

  public togglePin(cid: string): void {
    this._cmts.togglePin(cid);
  }

  public resolveComment(cid: string): Promise<void> {
    return this._cmts.resolveComment(this.tid(), this.pid(), cid);
  }

  public onCanvasPointerMove(ev: PointerEvent): void {
    this._gesture.onCanvasPointerMove(ev);
  }

  public onCanvasPointerCancel(): void {
    this._gesture.onCanvasPointerCancel();
  }

  public onCanvasPointerUp(): void {
    this._gesture.onCanvasPointerUp();
  }

  public deleteSelected(): Promise<void> {
    return this._editor.deleteSelected(this.tid(), this.pid());
  }

  public async duplicateSelected(): Promise<void> {
    await this._editor.duplicateSelected(this.tid(), this.pid());
  }

  public copySelected(): void {
    const sel = this.selected();
    if (!sel) return;
    this._clipboard.put(sel);
  }

  public openContextMenu(ev: MouseEvent, el: IWireElement): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.selectedId.set(el.id);
    this._ctxMenu.openAt(ev.clientX, ev.clientY, el.id);
  }

  public closeContextMenu(): void {
    this._ctxMenu.close();
  }

  public bringToFront(elId?: string): Promise<void> {
    return this._layerOrder.bringToFront(this.tid(), this.pid(), elId);
  }

  public sendToBack(elId?: string): Promise<void> {
    return this._layerOrder.sendToBack(this.tid(), this.pid(), elId);
  }

  public bringForward(elId?: string): Promise<void> {
    return this._layerOrder.bringForward(this.tid(), this.pid(), elId);
  }

  public sendBackward(elId?: string): Promise<void> {
    return this._layerOrder.sendBackward(this.tid(), this.pid(), elId);
  }

  public toggleLock(elId?: string): Promise<void> {
    return this._layerOrder.toggleLock(this.tid(), this.pid(), elId);
  }

  public reorderLayer(fromId: string, toId: string, position: 'above' | 'below'): Promise<void> {
    return this._layerOrder.reorderLayer(this.tid(), this.pid(), fromId, toId, position);
  }

  public setLeftPanel(panel: 'components' | 'symbols' | 'images'): void {
    this._panels.setLeftPanel(panel);
  }

  public async onLayerReorder(ev: IReorderEvent): Promise<void> {
    await this.reorderLayer(ev.fromId, ev.toId, ev.position);
  }

  public async pasteClipboard(): Promise<void> {
    const src = this._clipboard.peek();
    if (!src) return;
    const pageId = this.activePageId();
    if (!pageId) return;
    await this._editor.paste(this.tid(), this.pid(), pageId, src);
  }

  public toggleGrid(): void {
    void this._session.setGridConfig({
      ...this.gridConfig(),
      visible: !this.gridConfig().visible,
    });
  }

  public async onAiSubmit(ev: Event): Promise<void> {
    ev.preventDefault();
    const prompt = this.aiPrompt().trim();
    const pageId = this.activePageId();
    if (!prompt || !pageId) return;
    try {
      const result = await this._ai_orch.generate({
        prompt,
        tid: this.tid(),
        pid: this.pid(),
        pageId,
        existing: this.elements(),
        baseZIndex: this._factory.nextZIndex(this.elements()),
      });
      if (result) this.aiPrompt.set('');
    } catch (e) {
      console.error('[ai] generate failed', e);
      await this._dialog.alert({
        title: 'AI generation failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  public zoomIn(): void {
    this._zoomSvc.zoomIn();
  }

  public zoomOut(): void {
    this._zoomSvc.zoomOut();
  }

  public toggleZoomFit(): void {
    this._zoomSvc.toggleAutoFit();
  }

  public zoomPct(): string {
    return this._zoomSvc.zoomPct();
  }

  public toggleLeft(): void {
    this._panels.toggleLeft();
  }

  public toggleRight(): void {
    this._panels.toggleRight();
  }

  public trackEl = (_: number, e: IWireElement): string => e.id;
  public trackCursor = (_: number, c: ICursorState): string => c.userId;
  public trackPeer = (_: number, c: ICursorState): string => c.userId;

  public cursorsList(): ICursorState[] {
    return Array.from(this._collab.cursors().values());
  }

  public readonly shortcutsApi: IEditorShortcutsApi = {
    isEditing: () => this.editingId() != null,
    canPaste: () => this._clipboard.canPaste(),
    hasSelection: () => this.selected() != null,
    selectionCount: () => this.selectionCount(),
    commentMode: () => this.commentMode(),
    toggleLeft: () => this.toggleLeft(),
    toggleRight: () => this.toggleRight(),
    toggleGrid: () => this.toggleGrid(),
    copySelected: () => this.copySelected(),
    pasteClipboard: () => {
      void this.pasteClipboard();
    },
    duplicateSelected: () => {
      void this.duplicateSelected();
    },
    deleteSelected: () => {
      void this.deleteSelected();
    },
    cancelInteractions: () => this.onCanvasPointerCancel(),
    clearSelection: () => {
      this.selectedId.set(null);
      this.extraSelectedIds.set(new Set());
    },
    closeCommentPin: () => this._cmts.closePin(),
    toggleCommentMode: () => this._cmts.toggleMode(),
    closeContextMenu: () => this.closeContextMenu(),
  };

  public selectElement(elId: string): void {
    this.selectedId.set(elId);
    this._collab.sendSelection(elId);
  }

  public dividerOrientation = dividerOrientationFn;
  public dividerStyleOf = dividerStyleOfFn;
  public hasBorder = hasBorderFn;
  public hasBackground = hasBackgroundFn;

  public hasRichText = hasRichTextFn;
  public hasFontSize = hasFontSizeFn;
  public buttonVariantOf = buttonVariantOfFn;

  public isTextual = isTextualFn;
  public hasTextField = hasTextFieldFn;

  public isCheckedOf = isCheckedOfFn;

  public handleDirsFor(el: IWireElement): readonly HandleDir[] {
    if (el.type === 'divider') {
      return this.dividerOrientation(el) === 'h' ? (['e', 'w'] as const) : (['n', 's'] as const);
    }
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
  }

  public startEditingSelected(): void {
    const sel = this.selected();
    if (!sel || sel.locked) return;
    if (!this.isTextual(sel.type) && sel.type !== 'list') return;
    this._inline.begin(sel.id);
  }

  public onInlineEditDblClick(ev: MouseEvent, el: IWireElement): void {
    if (el.locked) return;
    if (el.type === 'image') {
      ev.stopPropagation();
      ev.preventDefault();
      this.selectedId.set(el.id);
      this._panels.setLeftPanel('images');
      return;
    }
    if (!this.isTextual(el.type) && el.type !== 'list') return;
    ev.stopPropagation();
    ev.preventDefault();
    this.selectedId.set(el.id);
    this._inline.beginWithFocus(el.id);
  }
}
