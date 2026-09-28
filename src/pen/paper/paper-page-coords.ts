/**
 * Validates that a pen-emitted {section, owner, book, page} tuple is
 * complete enough to request a PDF from NoteServer.
 *
 * `book` is allowed to be 0 because Neo's canonical paper IDs routinely use
 * book=0 (e.g. the registered `3_54_0`, `3_55_0`, `3_56_0` test PDFs — see
 * GET /api/v1/papers). Previously this guard required book > 0, which
 * silently disabled PDF background rendering for every matching paper.
 */
export function hasValidPageCoords(params: {
  section?: number | null;
  owner?: number | null;
  noteId?: number | null;
  pageNumber?: number | null;
}): boolean {
  const { section, owner, noteId, pageNumber } = params;
  return (
    typeof section === 'number' &&
    typeof owner === 'number' &&
    typeof noteId === 'number' &&
    typeof pageNumber === 'number' &&
    section > 0 &&
    owner > 0 &&
    noteId >= 0 &&
    pageNumber > 0
  );
}
