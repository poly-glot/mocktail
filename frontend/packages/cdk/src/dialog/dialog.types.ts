export type DialogKind = 'alert' | 'confirm' | 'prompt';

export interface DialogBase {
  id: string;
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface AlertConfig extends DialogBase {
  kind: 'alert';
}

export interface ConfirmConfig extends DialogBase {
  kind: 'confirm';
}

export interface PromptConfig extends DialogBase {
  kind: 'prompt';
  inputLabel?: string;
  inputValue?: string;
  inputPlaceholder?: string;
  validate?: (value: string) => string | null;
}

export type DialogConfig = AlertConfig | ConfirmConfig | PromptConfig;

export interface AlertOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  inputLabel?: string;
  inputValue?: string;
  inputPlaceholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
}
