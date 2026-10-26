// D-077: a stable, distinguishable colour per project from its id (no setup). 12 hues.
export function projectHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 12) * 30;
}
export function projectStyle(id: string | null | undefined): Record<string, string> {
  if (!id) return {};
  return { '--project-hue': String(projectHue(id)) };
}

/** D-151: tags get a colour from their name the same way, so each tag looks the same everywhere. */
export function tagStyle(name: string): Record<string, string> {
  return { '--tag-hue': String(projectHue(name)) };
}
