export type OfflineNote = {
  section: number;
  owner: number;
  noteId: number;
  pages?: number[];
};

export function noteKey(n: OfflineNote): string {
  return `${n.section}_${n.owner}_${n.noteId}`;
}

export function noteDisplayName(n: OfflineNote): string {
  return `Note ${n.noteId}`;
}

export function noteSubtitle(n: OfflineNote): string {
  return `Section ${n.section} · Owner ${n.owner}`;
}
