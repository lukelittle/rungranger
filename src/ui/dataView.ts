/**
 * Read-only data access for the UI: live controller memory when online,
 * the project's stored values when offline.
 */
import { resolveAddress } from '../core/address';
import { getDataValue } from '../core/project';
import type { Project } from '../core/types';
import type { PlcEngine } from '../runtime/engine';

export interface DataView {
  live: boolean;
  /** Returns null if the address does not resolve. */
  read(address: string): number | null;
}

export function makeDataView(project: Project, engine: PlcEngine | null): DataView {
  if (engine) {
    return {
      live: true,
      read(address) {
        try {
          return engine.mem.read(resolveAddress(address, engine.mem.defs));
        } catch {
          return null;
        }
      },
    };
  }
  return {
    live: false,
    read(address) {
      try {
        return getDataValue(project, address);
      } catch {
        return null;
      }
    },
  };
}

export function formatValue(v: number | null, isFloat = false): string {
  if (v === null) return '?';
  if (isFloat) {
    if (!Number.isFinite(v)) return String(v);
    const s = Number(v.toPrecision(7)).toString();
    return s.includes('.') || s.includes('e') ? s : `${s}.0`;
  }
  return String(v);
}
