type GlobalShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "metaKey" | "shiftKey" | "target"
>;

const interactiveSelector = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  "[role='slider']"
].join(",");

export function shouldIgnoreGlobalShortcut(event: GlobalShortcutEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return true;
  }

  const closest = (event.target as { closest?: (selector: string) => unknown } | null)?.closest;
  return typeof closest === "function" && Boolean(closest.call(event.target, interactiveSelector));
}
