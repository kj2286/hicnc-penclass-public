/**
 * @file ui:alert-dialog
 * @requires @seed-design/react@^2.0.0
 * @requires @seed-design/css@^2.0.0
 **/

import { Dialog } from "@seed-design/react";
import { forwardRef } from "react";
import { ActionButton, type ActionButtonProps } from "./action-button";
import * as React from "react";
import { createPortal } from "react-dom";

export interface AlertDialogRootProps extends Dialog.RootProps {
  /**
   * @default "alertdialog"
   */
  role?: Dialog.RootProps["role"];
  /**
   * @default false
   */
  closeOnInteractOutside?: Dialog.RootProps["closeOnInteractOutside"];
}

/**
 * @see https://seed-design.io/react/components/alert-dialog
 */
export const AlertDialogRoot = ({ children, ...otherProps }: AlertDialogRootProps) => {
  // 열려 있는 동안 배경 스크롤 잠금 — 공용 Dialog 와 같은 규칙(2026-08-18)
  const open = (otherProps as { open?: boolean }).open;
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  return (
    <Dialog.Root role="alertdialog" closeOnInteractOutside={false} {...otherProps}>
      {children}
    </Dialog.Root>
  );
};
AlertDialogRoot.displayName = "AlertDialogRoot";

export interface AlertDialogContentProps extends Dialog.ContentProps {
  layerIndex?: number;
}

export const AlertDialogContent = forwardRef<HTMLDivElement, AlertDialogContentProps>(
  ({ children, layerIndex, ...otherProps }, ref) => {
    // body 포털 — 조상 transform 이 fixed 기준을 깨 팝업이 스크롤 아래에 뜨던
    // 문제(2026-08-18). 공용 Dialog 와 같은 규칙.
    return createPortal(
      <div data-portal="dialog">
      <Dialog.Positioner style={{ "--layer-index": layerIndex } as React.CSSProperties}>
        {/* 팝업 공통 규칙: 딤 없음 + 그림자/패딩 20px/입력 40px (index.css .sp-dialog*) */}
        <Dialog.Backdrop className="sp-dialog-backdrop" />
        <Dialog.Content
          ref={ref}
          {...otherProps}
          className={`sp-dialog border border-line-weak shadow-2xl ${
            (otherProps as { className?: string }).className ?? ""
          }`}
        >
          {children}
        </Dialog.Content>
      </Dialog.Positioner>
      </div>,
      document.body,
    );
  },
);

export interface AlertDialogTriggerProps extends Dialog.TriggerProps {}

export const AlertDialogTrigger = Dialog.Trigger;

export interface AlertDialogHeaderProps extends Dialog.HeaderProps {}

export const AlertDialogHeader = Dialog.Header;

export interface AlertDialogTitleProps extends Dialog.TitleProps {}

export const AlertDialogTitle = Dialog.Title;

export interface AlertDialogDescriptionProps extends Dialog.DescriptionProps {}

export const AlertDialogDescription = Dialog.Description;

export interface AlertDialogFooterProps extends Dialog.FooterProps {}

export const AlertDialogFooter = Dialog.Footer;

export interface AlertDialogActionProps
  extends Omit<Dialog.ActionProps, "color">,
    ActionButtonProps {}

export const AlertDialogAction = forwardRef<HTMLButtonElement, AlertDialogActionProps>(
  (props, ref) => {
    return (
      <Dialog.Action asChild>
        <ActionButton {...props} ref={ref} />
      </Dialog.Action>
    );
  },
);

/**
 * This file is a snippet from SEED Design, helping you get started quickly with @seed-design/* packages.
 * You can extend this snippet however you want.
 */
