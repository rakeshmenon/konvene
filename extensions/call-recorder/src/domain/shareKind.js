// What the user chose to share in Chrome's picker, and what that means for the sound we record.
// Kept apart from Chrome and from the audio code so the rule can be read, and tested, on its own.
/** Maps the `displaySurface` Chrome reports for a shared stream. */
export function shareKindOf(displaySurface) {
  switch (displaySurface) {
    case "browser":
      return "tab";
    case "monitor":
      return "screen";
    case "window":
      return "window";
    default:
      return "unknown";
  }
}
/**
 * - tab: only that tab's sound, so the call tab's copy stays.
 * - screen: everything the computer plays, the call included, so the copy steps aside.
 * - window, unknown: Chrome does not say what the sound holds. Keeping the copy risks a doubled call, dropping it
 *   risks a missing one, and a missing call is the worse mistake.
 */
export function soundPlanFor(kind) {
  return { keepCallTabCopy: kind !== "screen" };
}
/** What to tell the user when they shared something that carries no sound. */
export function noSoundAdvice(kind) {
  if (kind === "window") return "A single window has no sound to share. Choose a tab, or Entire screen with the sound box ticked.";
  if (kind === "screen") return "The screen was shared without its sound. Tick the box to share system audio in the picker.";
  return "No sound was shared. In the picker choose a tab or Entire screen, and tick the box to share sound.";
}

/**
 * @typedef {"tab" | "screen" | "window" | "unknown"} ShareKind
 */

/**
 * How a shared sound fits into the recording.
 * @typedef {object} SoundPlan
 * @property {boolean} keepCallTabCopy Whether the recording keeps its own copy of the call tab's sound. A whole screen's sound already contains the call, so the copy steps aside. Two copies a few milliseconds apart would sound like an echo.
 */
