import { Building2 } from "lucide-react";
import { avatarTint, type AvatarProps } from "./avatarTint";
import "./workspace-parts.css";

export function SiteAvatar({ name, size = "default", className = "" }: AvatarProps) {
  const assigned = Boolean(name?.trim());
  return (
    <span
      aria-hidden="true"
      className={`wx-avatar wx-avatar--site wx-avatar--${size} ${assigned ? `wx-avatar--tint-${avatarTint(name!)}` : "wx-avatar--empty"} ${className}`}
    >
      {assigned && <Building2 focusable="false" />}
    </span>
  );
}

export default SiteAvatar;
