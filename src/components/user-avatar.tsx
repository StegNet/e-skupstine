import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Photo from /api/avatar (Certilia or Gravatar), or initials when there is none. Decorative: the name is always shown next to it. */
export function UserAvatar({ name, image, size }: { name: string; image: string | null | undefined; size?: "sm" | "default" }) {
  return (
    <Avatar size={size}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback aria-hidden>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
