export type AvatarSize = "small" | "default" | "large";

export interface AvatarProps {
  name?: string | null;
  size?: AvatarSize;
  className?: string;
}

/** Stable across pages and sessions; deliberately sums UTF-16 code units. */
export function avatarTint(name: string): number {
  let sum = 0;
  for (let index = 0; index < name.length; index += 1) {
    sum = (sum + name.charCodeAt(index)) % 6;
  }
  return sum;
}
