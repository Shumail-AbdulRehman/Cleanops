import * as React from "react";
import { cn } from "../../lib/utils";
import * as LucideIcons from "lucide-react-native";

export type LucideIconName = keyof typeof LucideIcons;

interface IconProps {
  name: LucideIconName;
  size?: number;
  color?: string;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color, className, strokeWidth }: IconProps) {
  const LucideIcon = LucideIcons[name] as React.ComponentType<{
    size?: number;
    color?: string;
    className?: string;
    strokeWidth?: number;
  }>;

  if (!LucideIcon) {
    return null;
  }

  return (
    <LucideIcon
      size={size}
      color={color}
      className={cn(className)}
      strokeWidth={strokeWidth}
    />
  );
}
