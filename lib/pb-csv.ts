export const pbCsvColumns = ["athleteId", "name", "university", "event", "time", "date", "meet", "sourceUrl"] as const;
export type PbCsvInput = Record<typeof pbCsvColumns[number], string>;
export interface PbCsvRow { row: number; line: number; input: PbCsvInput }

/** UTF-8 CSV: quoted commas/newlines, doubled quotes, BOM, CRLF/LF. No guessing delimiters. */
export function parsePbCsv(text: string): PbCsvRow[] {
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("CSV contains a NUL character");
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], value = "", quoted = false, closed = false, line = 1, start = 1;
  const field = () => { cells.push(value); value = ""; closed = false; };
  const row = () => {
    const hasContent = cells.length > 0 || value !== "" || closed;
    field();
    if (hasContent) rows.push({ cells, line: start });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; }
      } else if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        value += "\n"; line++;
      } else value += c;
    } else if (c === ",") field();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row(); line++; start = line;
    } else if (c === '"' && value === "" && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error(`Malformed CSV quote at line ${line}`);
      value += c;
    }
  }
  if (quoted) throw new Error(`Unclosed CSV quote at line ${start}`);
  if (value || closed || cells.length) row();
  const header = rows.shift()?.cells.map((v) => v.trim());
  if (!header || header.length !== pbCsvColumns.length || new Set(header).size !== header.length ||
      pbCsvColumns.some((key) => !header.includes(key))) throw new Error(`CSV must have exactly these headers: ${pbCsvColumns.join(",")}`);
  return rows.map(({ cells, line }, i) => {
    if (cells.length !== header.length) throw new Error(`CSV column count mismatch at line ${line}`);
    const input = Object.fromEntries(header.map((key, j) => [key, cells[j]])) as PbCsvInput;
    return { row: i + 1, line, input };
  });
}
