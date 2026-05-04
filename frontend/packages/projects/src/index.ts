export { ProjectApiService } from './services/project-api/project-api.service';
export { ProjectsRepository } from './repositories/projects.repository';
export { PagesRepository } from './repositories/pages.repository';
export { ElementsRepository } from './repositories/elements.repository';
export { CommentsRepository } from './repositories/comments.repository';
export { ActivityRepository } from './repositories/activity.repository';
export { GridConfigRepository } from './repositories/grid-config.repository';
export { decodeElement, stripUndefined } from './repositories/element-codec';
export { firestoreSignal } from './repositories/firestore-signal';
export { AiService } from './services/ai/ai.service';
export { DashboardComponent } from './components/dashboard/dashboard.component';
export type {
  IProject,
  IPageDoc,
  IWireElement,
  IImageRef,
  IComment,
  IActivity,
  IGridConfig,
  ActivityType,
  ElementType,
} from './interfaces/project.interface';
export type { IAiGenerated, IAiReviewIssue } from './services/ai/ai.service';
export {
  BORDER_STYLES,
  borderStyleOf,
  buttonVariantOf,
  COLOR_PRESETS,
  DEFAULT_FONT_SIZE,
  DIVIDER_STROKE_DEFAULT,
  DIVIDER_STROKE_MAX,
  DIVIDER_STROKE_MIN,
  DIVIDER_STYLES,
  dividerOrientation,
  dividerStrokeOf,
  dividerStyleOf,
  FONT_SIZES,
  fontFamilyOf,
  fontSizeOf,
  GOOGLE_FONTS,
  hasBackground,
  hasBorder,
  hasCheckedState,
  hasFontSize,
  hasIcon,
  hasRichText,
  hasTextField,
  iconNameOf,
  imageRefOf,
  isCheckedOf,
  isItalicOf,
  isTextual,
  isUnderlineOf,
  textAlignOf,
} from './element-traits';
export type {
  BorderStyle,
  DividerStyle,
  FontSize,
  IFontSizeOption,
  TextAlign,
} from './element-traits';
