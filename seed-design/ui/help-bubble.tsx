/**
 * @file ui:help-bubble
 * @requires @seed-design/react@^2.0.0
 * @requires @seed-design/css@^2.0.0
 **/

import IconXmarkLine from "@karrotmarket/react-monochrome-icon/IconXmarkLine";
import { Icon, HelpBubble as SeedHelpBubble } from "@seed-design/react";
import { forwardRef } from "react";
import type * as React from "react";

export interface HelpBubbleTriggerProps extends Omit<SeedHelpBubble.RootProps, "children"> {
  title: React.ReactNode;

  description?: React.ReactNode;

  showCloseButton?: boolean;

  children?: React.ReactNode;

  contentProps?: SeedHelpBubble.ContentProps;

  zIndexOffset?: number;
}

export const HelpBubbleTrigger = forwardRef<HTMLButtonElement, HelpBubbleTriggerProps>(
  (
    {
      showCloseButton = false,
      title,
      description,
      contentProps,
      zIndexOffset,
      children,
      ...otherProps
    },
    ref,
  ) => {
    return (
      <SeedHelpBubble.Root {...otherProps}>
        <SeedHelpBubble.Trigger asChild ref={ref}>
          {children}
        </SeedHelpBubble.Trigger>
        <SeedHelpBubble.Positioner
          style={{ "--z-index-offset": zIndexOffset } as React.CSSProperties}
        >
          <SeedHelpBubble.Content {...contentProps}>
            <SeedHelpBubble.Arrow>
              <SeedHelpBubble.ArrowTip />
            </SeedHelpBubble.Arrow>
            <SeedHelpBubble.Body>
              <SeedHelpBubble.Title>{title}</SeedHelpBubble.Title>
              {description && (
                <SeedHelpBubble.Description>{description}</SeedHelpBubble.Description>
              )}
            </SeedHelpBubble.Body>
            {showCloseButton ? (
              // You may implement your own i18n for dismiss label
              <SeedHelpBubble.CloseButton aria-label="닫기">
                <Icon svg={<IconXmarkLine />} />
              </SeedHelpBubble.CloseButton>
            ) : null}
          </SeedHelpBubble.Content>
        </SeedHelpBubble.Positioner>
      </SeedHelpBubble.Root>
    );
  },
);
HelpBubbleTrigger.displayName = "HelpBubbleTrigger";

export interface HelpBubbleAnchorProps extends Omit<SeedHelpBubble.RootProps, "children"> {
  title: React.ReactNode;

  description?: React.ReactNode;

  showCloseButton?: boolean;

  children?: React.ReactNode;

  contentProps?: SeedHelpBubble.ContentProps;

  zIndexOffset?: number;
}

export const HelpBubbleAnchor = forwardRef<HTMLDivElement, HelpBubbleAnchorProps>(
  (
    {
      showCloseButton = false,
      title,
      description,
      contentProps,
      zIndexOffset,
      children,
      ...otherProps
    },
    ref,
  ) => {
    return (
      <SeedHelpBubble.Root {...otherProps}>
        <SeedHelpBubble.Anchor asChild ref={ref}>
          {children}
        </SeedHelpBubble.Anchor>
        <SeedHelpBubble.Positioner
          style={{ "--z-index-offset": zIndexOffset } as React.CSSProperties}
        >
          <SeedHelpBubble.Content {...contentProps}>
            <SeedHelpBubble.Arrow>
              <SeedHelpBubble.ArrowTip />
            </SeedHelpBubble.Arrow>
            <SeedHelpBubble.Body>
              <SeedHelpBubble.Title>{title}</SeedHelpBubble.Title>
              {description && (
                <SeedHelpBubble.Description>{description}</SeedHelpBubble.Description>
              )}
            </SeedHelpBubble.Body>
            {showCloseButton ? (
              // You may implement your own i18n for dismiss label
              <SeedHelpBubble.CloseButton aria-label="닫기">
                <Icon svg={<IconXmarkLine />} />
              </SeedHelpBubble.CloseButton>
            ) : null}
          </SeedHelpBubble.Content>
        </SeedHelpBubble.Positioner>
      </SeedHelpBubble.Root>
    );
  },
);
HelpBubbleAnchor.displayName = "HelpBubbleAnchor";

/**
 * This file is a snippet from SEED Design, helping you get started quickly with @seed-design/* packages.
 * You can extend this snippet however you want.
 */
