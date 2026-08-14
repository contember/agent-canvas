// agent-canvas's canvas component set: the kernel's components plus the ones
// only this host can back (SecretInput needs the daemon's secret endpoints).
export * from "@fabrika/canvas-kernel/components";
export { SecretInput } from "./SecretInput";
