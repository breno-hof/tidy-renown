/**
 * Minimal ambient declarations for the Foundry VTT v14 / dnd5e 6.x runtime.
 *
 * The module only touches a small, stable surface of the Foundry API, so it
 * declares the globals it uses instead of depending on a full type package.
 * Documents are typed loosely (`any`) on purpose.
 */

declare const game: any;
declare const ui: any;
declare const CONST: any;
declare const CONFIG: any;
declare const foundry: any;
declare const Actor: any;
declare const Hooks: {
  on(hook: string, fn: (...args: any[]) => unknown): number;
  once(hook: string, fn: (...args: any[]) => unknown): number;
  off(hook: string, id: number): void;
  callAll(hook: string, ...args: unknown[]): boolean;
};
declare function fromUuidSync(uuid: string, options?: Record<string, unknown>): any;
