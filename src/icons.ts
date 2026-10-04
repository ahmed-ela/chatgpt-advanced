import { ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, GripVertical, LoaderCircle, Pause, Pencil, Play, Plus, Trash2 } from "lucide";

// Named imports keep the extension self-contained and exclude unused icons.
const icons = {
  "arrow-right": ArrowRight, send: ArrowUp, check: Check,
  "chevron-down": ChevronDown, "chevron-right": ChevronRight,
  grip: GripVertical, loader: LoaderCircle, pause: Pause,
  edit: Pencil, play: Play, plus: Plus, trash: Trash2,
};
const escapeAttribute = (value: string | number) => String(value).replace(/[&"<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]!);

/** Decorative SVG; the containing button supplies its accessible name. */
export function icon(name: keyof typeof icons, size = 16, className = ""): string {
  const children = icons[name].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeAttribute(value!)}"`).join(" ")}></${tag}>`).join("");
  return `<svg class="icon icon-${name}${className ? ` ${escapeAttribute(className)}` : ""}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
}
