// Limits shared by the client and the server.

// Characters of document text sent in one plan request (default; presets with small
// free tiers use less). Larger documents are planned from an outline instead.
// The whole document is always kept on the client.
export const MAX_DOC_CHARS = 100_000;

// Largest file the picker accepts. It also bounds how much text a document can hold.
export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
