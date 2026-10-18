export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.34 }} className="grid shrink-0 place-items-center rounded-full bg-brand-tint font-semibold text-brand">{initials}</span>;
}
