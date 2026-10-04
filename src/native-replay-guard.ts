export type ReplayDecision = "allow" | "block" | null;

interface ReplayTarget {
  composer: HTMLElement;
  button: HTMLButtonElement;
  form: HTMLFormElement | null;
  expiresAt: number;
  isCurrent: () => boolean;
}
interface ReplayAttempt extends ReplayTarget {
  phase: "initial" | "pending" | "paired-submit" | "revoked";
  active: boolean;
  initialClick?: MouseEvent;
  initialSubmit: boolean;
  observer: MutationObserver;
  timer: number;
  onEdit: () => void;
}

/**
 * Some model extensions cancel Send, asynchronously arm their request handler,
 * then replay the same native action. Permit that continuation once, without
 * opening the queue's ordinary user-send interception to other actions.
 */
export class NativeReplayGuard {
  private attempt: ReplayAttempt | null = null;

  begin(target: ReplayTarget): void {
    this.revoke();
    const attempt: ReplayAttempt = {
      ...target, phase: "initial", active: true, initialSubmit: false, timer: 0,
      observer: new MutationObserver(() => this.revoke(attempt)),
      onEdit: () => this.revoke(attempt),
    };
    this.attempt = attempt;
    // Observe edits themselves, not just the final string: editing and restoring
    // identical text must not let a callback from the earlier draft submit it.
    attempt.observer.observe(target.composer, { childList: true, characterData: true, subtree: true });
    target.composer.addEventListener("beforeinput", attempt.onEdit, true);
    target.composer.addEventListener("input", attempt.onEdit, true);
    target.composer.addEventListener("change", attempt.onEdit, true);
    attempt.timer = window.setTimeout(() => this.revoke(attempt), Math.max(0, target.expiresAt - Date.now()));
  }

  observeInitialClick(event: MouseEvent): void {
    const attempt = this.attempt;
    if (attempt?.phase === "initial" && !attempt.initialClick && event.composedPath().includes(attempt.button)) {
      attempt.initialClick = event;
    }
  }

  observeInitialSubmit(event: Event): void {
    const attempt = this.attempt;
    if (attempt?.active && event.target === attempt.form) attempt.initialSubmit = true;
  }

  finishInitial(): void {
    const attempt = this.attempt;
    if (!attempt || attempt.phase !== "initial") return;
    if (attempt.initialClick?.defaultPrevented && !attempt.initialSubmit && this.current(attempt)) attempt.phase = "pending";
    else this.revoke(attempt);
  }

  click(event: MouseEvent): ReplayDecision {
    const attempt = this.attempt;
    if (!attempt || !event.composedPath().includes(attempt.button)) return null;
    if (event.isTrusted) return null;
    if (attempt.phase === "pending" && this.current(attempt)) {
      // Consume the click permission before another listener can re-enter. Its
      // default form submission is synchronous; no later-task submit is granted.
      attempt.phase = "paired-submit";
      queueMicrotask(() => { if (attempt.phase === "paired-submit") this.revoke(attempt); });
      return "allow";
    }
    this.revoke(attempt);
    return "block";
  }

  submit(event: SubmitEvent): ReplayDecision {
    const attempt = this.attempt;
    if (!attempt || !attempt.form || event.target !== attempt.form) return null;
    // requestSubmit() creates a browser-generated SubmitEvent even when script
    // called it. Trusted human clicks/Enter remain intercepted by the queue.
    if ((attempt.phase === "pending" || attempt.phase === "paired-submit") &&
        (event.submitter == null || event.submitter === attempt.button) && this.current(attempt)) {
      this.revoke(attempt);
      return "allow";
    }
    this.revoke(attempt);
    return "block";
  }

  check(): void {
    const attempt = this.attempt;
    if (attempt && attempt.phase !== "revoked" && !this.current(attempt)) this.revoke(attempt);
  }

  trustedIntent(): void {
    const attempt = this.attempt;
    if (!attempt) return;
    this.revoke(attempt);
    // A genuinely new user action after the attempt ended can use this form.
    // During an attempt it still follows the queue's normal interception.
    if (!attempt.active) this.attempt = null;
  }

  finish(): void {
    const attempt = this.attempt;
    if (!attempt) return;
    this.revoke(attempt);
    attempt.active = false;
    // Keep only the revoked target identities. Dropping them on route change
    // would let an old callback submit a still-mounted form on a new blank chat.
  }

  revoke(attempt = this.attempt): void {
    if (!attempt || attempt !== this.attempt) return;
    attempt.phase = "revoked";
    clearTimeout(attempt.timer);
    attempt.observer.disconnect();
    attempt.composer.removeEventListener("beforeinput", attempt.onEdit, true);
    attempt.composer.removeEventListener("input", attempt.onEdit, true);
    attempt.composer.removeEventListener("change", attempt.onEdit, true);
  }

  private current(attempt: ReplayAttempt): boolean {
    // Drain pending mutation records too: an edit and replay can occur in one
    // script turn before the MutationObserver callback gets a chance to run.
    if (attempt.observer.takeRecords().length) { this.revoke(attempt); return false; }
    return attempt.active && Date.now() < attempt.expiresAt && attempt.composer.isConnected && attempt.button.isConnected &&
      attempt.button.form === attempt.form && (!attempt.form || (attempt.form.isConnected && attempt.form.contains(attempt.composer))) &&
      attempt.isCurrent();
  }
}
