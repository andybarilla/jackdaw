import {
  createEmptyPersistedAppState,
  parsePersistedAppState,
  parsePersistedWorkspaceState,
  type PersistedAppState,
  type PersistedWorkspaceState,
} from "./schema.js";

export function migratePersistedAppState(value: unknown): PersistedAppState {
  if (value === undefined) {
    return createEmptyPersistedAppState();
  }

  if (!isObject(value) || typeof value.version !== "number") {
    throw new TypeError("Persisted app state version must be a number");
  }

  switch (value.version) {
    case 1:
      return parsePersistedAppState(value);
    default:
      throw new TypeError(`Unsupported persisted app state version: ${String(value.version)}`);
  }
}

export function migratePersistedWorkspaceState(value: unknown): PersistedWorkspaceState {
  if (!isObject(value) || typeof value.version !== "number") {
    throw new TypeError("Persisted workspace state version must be a number");
  }

  switch (value.version) {
    case 1:
      return parsePersistedWorkspaceState(value);
    default:
      throw new TypeError(`Unsupported persisted workspace state version: ${String(value.version)}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
