/** Groups actors by their sidebar folder so long lists read like the Actors directory. */

export interface FolderGroup<T> {
  id: string;
  name: string;
  actors: T[];
}

/** "Parent / Child" path of the actor's folder, or "" when unfiled. */
export function folderPath(actor: any): string {
  const folder = actor?.folder;
  if (!folder) return "";
  const ancestors: any[] = Array.isArray(folder.ancestors) ? folder.ancestors : [];
  return [...ancestors]
    .reverse()
    .map((f) => f.name)
    .concat(folder.name)
    .join(" / ");
}

/**
 * Buckets items by folder (sorted by path; unfiled actors last) and sorts each
 * bucket by name. `unfiledLabel` names the bucket of actors without a folder.
 */
export function groupByFolder<T extends { name: string }>(
  items: T[],
  actorOf: (item: T) => any,
  unfiledLabel: string,
): FolderGroup<T>[] {
  const groups = new Map<string, FolderGroup<T> & { path: string }>();
  for (const item of items) {
    const actor = actorOf(item);
    const id = actor?.folder?.id ?? "";
    const path = folderPath(actor);
    const group = groups.get(id) ?? { id, name: path || unfiledLabel, path, actors: [] as T[] };
    group.actors.push(item);
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    group.actors.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...groups.values()]
    .sort((a, b) => {
      if (!a.path !== !b.path) return a.path ? -1 : 1;
      return a.path.localeCompare(b.path);
    })
    .map(({ id, name, actors }) => ({ id, name, actors }));
}
