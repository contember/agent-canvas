/**
 * Components agent-canvas adds on top of the kernel's set.
 *
 * Keep in sync with `daemon/client/components/index.ts` — the compiler injects
 * these names into authored JSX, and the browser resolves them from that barrel
 * through `#canvas/components`. A name here with no matching export renders as
 * undefined.
 */
import type { CanvasComponents } from "@fabrika/canvas-kernel/server";

export const HOST_COMPONENTS: CanvasComponents = {
  SecretInput: { requiredProps: { id: "string", label: "string", env: "string" } },
};
