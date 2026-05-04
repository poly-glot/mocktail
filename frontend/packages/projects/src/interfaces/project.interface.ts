export interface IGridConfig {
  visible: boolean;
  columns: number;
  gutter: number;
  margin: number;
  snap?: boolean;
}

export interface IProject {
  id: string;
  name: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
  deleted?: boolean;
  gridConfig?: IGridConfig;
}

export interface IPageDoc {
  id: string;
  name: string;
  order: number;
  width?: number;
  height?: number;
}

export type ElementType =
  | 'rect'
  | 'circle'
  | 'text'
  | 'heading'
  | 'link'
  | 'button'
  | 'input'
  | 'card'
  | 'image'
  | 'icon'
  | 'bar-chart'
  | 'donut'
  | 'table'
  | 'nav'
  | 'phone-frame'
  | 'checkbox'
  | 'toggle'
  | 'divider'
  | 'tag'
  | 'list';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface IImageRef {
  src: string;
  thumb?: string;
  source: 'unsplash';
  sourceId: string;
  downloadLocation: string;
  photographer: string;
  photographerUrl: string;
  width?: number;
  height?: number;
}

export interface IWireElement {
  id: string;
  pageId: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  zIndex: number;
  locked?: boolean;
  text?: string;
  variant?: string;
  color?: string;
  level?: HeadingLevel;
  data?: Record<string, unknown>;
}

export interface IComment {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  pageId?: string;
  elementId?: string;
  x?: number;
  y?: number;
  resolved: boolean;
  createdAt?: unknown;
}

export type ActivityType =
  | 'project-created'
  | 'project-renamed'
  | 'element-added'
  | 'element-deleted'
  | 'ai-generated'
  | 'comment-added'
  | 'comment-resolved';

export interface IActivity {
  id: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  projectId: string;
  projectName?: string;
  summary: string;
  createdAt?: unknown;
}
