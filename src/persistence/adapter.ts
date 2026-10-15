/**
 * Storage adapter interface. The app talks only to this interface, so other
 * back ends (for example a GitHub repository or a file system folder) can be
 * added later without touching the editor or the runtime.
 */
import type { Project } from '../core/types';

export interface ProjectSummary {
  id: string;
  name: string;
  modifiedAt: string;
  equipment: Project['equipment'];
  rungCount: number;
}

export interface LoadResult {
  project: Project | null;
  warnings: string[];
  errors: string[];
}

export interface ProjectStore {
  /** Human-readable name of the backend, e.g. "Browser storage (IndexedDB)". */
  readonly label: string;
  list(): Promise<ProjectSummary[]>;
  /** Loads and validates a project. Corrupted records are recovered where possible. */
  load(id: string): Promise<LoadResult>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
  /** Small key/value settings store (last opened project, UI preferences). */
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

/*
 * Sketch of a future GitHub-backed adapter (not implemented):
 *
 *   class GitHubProjectStore implements ProjectStore {
 *     label = 'GitHub repository';
 *     constructor(private repo: string, private branch: string, private auth: AuthProvider) {}
 *     list()  -> GET /repos/{repo}/contents/projects            (one JSON file per project)
 *     load()  -> GET /repos/{repo}/contents/projects/{id}.json  then importProject()
 *     save()  -> PUT with the file's current sha (optimistic concurrency)
 *   }
 *
 * Authentication must use a user-scoped OAuth/device flow token held by the user,
 * never a shared secret embedded in the deployed site.
 */

export function summarize(p: Project): ProjectSummary {
  return { id: p.id, name: p.name, modifiedAt: p.modifiedAt, equipment: p.equipment, rungCount: p.program.rungs.length };
}
