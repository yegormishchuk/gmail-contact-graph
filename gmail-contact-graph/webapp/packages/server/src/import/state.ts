// Whether an import is running. The importer sets it; edit routes read it,
// since an edit made while the parser runs would not carry over to the
// database the import produces.
let importing = false;

export function isImporting(): boolean {
  return importing;
}

export function setImporting(value: boolean): void {
  importing = value;
}
