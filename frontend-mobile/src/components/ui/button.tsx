import { v5Colors } from '../../theme';
import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
  type ViewProps,
} from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { Text } from "./text";
import { useLanguage } from "../../i18n/LanguageProvider";
import { cn } from "../../lib/utils";
import { Icon, type LucideIconName } from "./icon";

const buttonVariants = cva(
  "flex-row items-center justify-center rounded-xl gap-2 min-h-[52px] px-4 py-2",
  {
    variants: {
      variant: {
        default: "bg-primary",
        secondary: "bg-secondary",
        destructive: "bg-destructive",
        outline: "border border-input bg-background",
        ghost: "bg-transparent",
        link: "bg-transparent",
      },
      size: {
        default: "min-h-[52px]",
        sm: "min-h-[48px] rounded-xl px-3",
        lg: "min-h-[60px] rounded-2xl px-6",
        icon: "min-h-[48px] w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva("text-base font-semibold", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
      ghost: "text-foreground",
      link: "text-primary",
    },
    size: {
      default: "text-base",
      sm: "text-sm",
      lg: "text-lg",
      icon: "text-sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends PressableProps, VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  label?: string;
  loading?: boolean;
  iconLeft?: LucideIconName;
  iconRight?: LucideIconName;
}

const Button = React.forwardRef<View, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      children,
      label,
      loading,
      disabled,
      iconLeft,
      iconRight,
      ...props
    },
    ref,
  ) => {
    const content = label ?? children;
    const { isRTL } = useLanguage();

    return (
      <Pressable
        ref={ref as any}
        accessibilityRole="button"
        accessibilityState={{
          disabled: !!(disabled || loading),
          busy: !!loading,
        }}
        disabled={disabled || loading}
        className={cn(
          buttonVariants({ variant, size }),
          (disabled || loading) && "opacity-50",
          className,
        )}
        {...props}
        style={[
          { flexDirection: isRTL ? "row-reverse" : "row", minHeight: 48 },
          props.style as ViewProps["style"],
        ]}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === "default" ? "#FFFFFF" : "#18181B"}
          />
        ) : null}
        {
          <>
            {iconLeft && !loading ? (
              <Icon
                name={iconLeft}
                color={variant === "default" || variant === "destructive" ? "#FFFFFF" : v5Colors.primary}
                size={size === "icon" ? 18 : 16}
                className={cn(
                  "text-current",
                  variant === "default"
                    ? "text-primary-foreground"
                    : "text-foreground",
                )}
              />
            ) : null}
            {typeof content === "string" ? (
              <Text
                style={{ flexShrink: 1, textAlign: "center" }}
                className={cn(buttonTextVariants({ variant, size }))}
              >
                {content}
              </Text>
            ) : (
              content
            )}
            {iconRight && !loading ? (
              <Icon
                name={iconRight}
                color={variant === "default" || variant === "destructive" ? "#FFFFFF" : v5Colors.primary}
                size={size === "icon" ? 18 : 16}
                className={cn(
                  "text-current",
                  variant === "default"
                    ? "text-primary-foreground"
                    : "text-foreground",
                )}
              />
            ) : null}
          </>
        }
      </Pressable>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants, buttonTextVariants };
