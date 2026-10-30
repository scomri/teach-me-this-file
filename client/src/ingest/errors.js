// Named ingestion error: `code` is stable for the UI, `message` is shown to the user.
export class IngestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
