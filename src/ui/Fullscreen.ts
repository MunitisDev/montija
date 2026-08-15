/**
 * The fullscreen toggle.
 *
 * **A page cannot put itself full screen on load.** The Fullscreen API requires
 * a user gesture, in every browser, by design — so "open the URL and it is
 * already full screen" is not something any web game can do. The two honest
 * answers are a button, which is this, and installing the game to a home
 * screen, which is what the web manifest is for: launched that way it opens
 * with no browser chrome at all and needs no gesture, because the browser
 * granted it up front.
 *
 * The whole `#game` element goes full screen rather than the canvas. Phaser
 * offers to fullscreen the canvas itself, and taking it would leave the HUD
 * behind in the page — the player would gain a bigger world and lose every
 * button around it.
 */

/** The bits of the older WebKit fullscreen API still worth asking for. */
interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

/**
 * `true` when this browser can go full screen at all.
 *
 * Notably false on an iPhone, where Safari supports the API for video and not
 * for elements. Rather than offer a button that does nothing, the caller hides
 * it — and on exactly those devices, installing to the home screen is the
 * answer anyway.
 */
export function fullscreenSupported(element: HTMLElement): boolean {
  const candidate = element as WebkitFullscreenElement;
  return typeof (element.requestFullscreen ?? candidate.webkitRequestFullscreen) === 'function';
}

export function isFullscreen(): boolean {
  const owner = document as WebkitFullscreenDocument;
  return (document.fullscreenElement ?? owner.webkitFullscreenElement ?? null) !== null;
}

/**
 * Enters or leaves fullscreen.
 *
 * Rejections are swallowed on purpose: a browser refusing the request — because
 * the gesture expired, or a policy forbids it — is not something the player can
 * act on, and an unhandled rejection in the console is noise rather than
 * information.
 */
export async function toggleFullscreen(element: HTMLElement): Promise<void> {
  const owner = document as WebkitFullscreenDocument;

  try {
    if (isFullscreen()) {
      await (document.exitFullscreen?.() ?? owner.webkitExitFullscreen?.());
      return;
    }

    const candidate = element as WebkitFullscreenElement;
    await (element.requestFullscreen?.({ navigationUI: 'hide' }) ??
      candidate.webkitRequestFullscreen?.());
  } catch {
    // Refused. The button simply stays as it was.
  }
}

/**
 * Wires a button to the toggle and keeps its label in step.
 *
 * The state is read from a `fullscreenchange` event rather than assumed from
 * the click, because the player can leave full screen with Escape or a system
 * gesture and the button must not go on claiming otherwise.
 */
export function bindFullscreenButton(options: {
  button: HTMLButtonElement;
  target: HTMLElement;
  onChange: (active: boolean) => void;
}): void {
  const { button, target, onChange } = options;

  if (!fullscreenSupported(target)) {
    button.hidden = true;
    return;
  }

  button.hidden = false;
  button.addEventListener('click', () => {
    void toggleFullscreen(target);
  });

  const report = (): void => onChange(isFullscreen());
  document.addEventListener('fullscreenchange', report);
  document.addEventListener('webkitfullscreenchange', report);
  report();
}
