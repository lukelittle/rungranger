/**
 * IndexedDB project store. Projects are stored as plain JSON-compatible objects
 * and are validated by importProject() every time they are loaded.
 */
import type { Project } from '../core/types';
import { importProject } from './schema';
import { summarize, type LoadResult, type ProjectStore, type ProjectSummary } from './adapter';

const DB_NAME = 'rungranger';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const SETTINGS = 'settings';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IndexedDbProjectStore implements ProjectStore {
  readonly label = 'Browser storage (IndexedDB)';
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory = globalThis.indexedDB, private dbName = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (!this.factory) {
          reject(new Error('IndexedDB is not available in this browser'));
          return;
        }
        const open = this.factory.open(this.dbName, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab'));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  private async store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.db();
    return db.transaction(name, mode).objectStore(name);
  }

  async list(): Promise<ProjectSummary[]> {
    const all = (await req((await this.store(PROJECTS, 'readonly')).getAll())) as unknown[];
    const out: ProjectSummary[] = [];
    for (const raw of all) {
      const r = importProject(raw);
      if (r.project) out.push(summarize(r.project));
      else if (raw && typeof raw === 'object' && 'id' in raw) {
        out.push({ id: String((raw as { id: unknown }).id), name: '(unreadable project)', modifiedAt: '', equipment: null, rungCount: 0 });
      }
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async load(id: string): Promise<LoadResult> {
    const raw = await req((await this.store(PROJECTS, 'readonly')).get(id));
    if (raw === undefined) return { project: null, warnings: [], errors: [`Project ${id} was not found in browser storage`] };
    const r = importProject(raw);
    if (r.project) r.project.id = id;
    return r;
  }

  async save(project: Project): Promise<void> {
    // Store a structured-clone-safe deep copy.
    const copy = JSON.parse(JSON.stringify(project)) as Project;
    await req((await this.store(PROJECTS, 'readwrite')).put(copy));
  }

  async delete(id: string): Promise<void> {
    await req((await this.store(PROJECTS, 'readwrite')).delete(id));
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return (await req((await this.store(SETTINGS, 'readonly')).get(key))) as T | undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await req((await this.store(SETTINGS, 'readwrite')).put(value, key));
  }
}

/** In-memory store used when IndexedDB is unavailable (private browsing in some browsers) and in tests. */
export class MemoryProjectStore implements ProjectStore {
  readonly label = 'Temporary memory (not saved)';
  private projects = new Map<string, string>();
  private settings = new Map<string, unknown>();

  async list(): Promise<ProjectSummary[]> {
    return [...this.projects.values()]
      .map((s) => importProject(safeParse(s)).project)
      .filter((p): p is Project => !!p)
      .map(summarize)
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async load(id: string): Promise<LoadResult> {
    const s = this.projects.get(id);
    if (!s) return { project: null, warnings: [], errors: [`Project ${id} not found`] };
    return importProject(safeParse(s));
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, JSON.stringify(project));
  }

  async delete(id: string): Promise<void> {
    this.projects.delete(id);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return this.settings.get(key) as T | undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    this.settings.set(key, value);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Asks the browser to keep this site's storage (best effort; browsers may ignore it). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    // ignore
  }
  return null;
}
