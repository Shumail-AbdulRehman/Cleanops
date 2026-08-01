import { avatarTint, type AvatarProps } from "./avatarTint";
import "./workspace-parts.css";

export function PersonAvatar({ name, size = "default", className = "" }: AvatarProps) {
  const assigned = Boolean(name?.trim());
  return (
    <span
      aria-hidden="true"
      className={`wx-avatar wx-avatar--person wx-avatar--${size} ${assigned ? `wx-avatar--tint-${avatarTint(name!)}` : "wx-avatar--empty"} ${className}`}
    >
      {assigned && (
        <svg viewBox="0 0 24 24" fill="currentColor" focusable="false">
          <circle cx="12" cy="8" r="4.3" />
          <path d="M3.5 24v-1.5a8.5 8.5 0 0 1 17 0V24Z" />
        </svg>
      )}
    </span>
  );
}

export default PersonAvatar;
