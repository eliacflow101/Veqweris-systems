import { deflateRawSync } from "node:zlib";

type FixtureOptions = {
  rows?: string[][];
  formula?: boolean;
  sharedStrings?: boolean;
  numericIdentifier?: boolean;
  malformedSheet?: boolean;
  multipleSheets?: boolean;
  corruptCrc?: boolean;
  worksheetPrefix?: string;
  worksheetXml?: string;
  externalRelationship?: boolean;
  extraEntries?: Array<{ name: string; contents: string }>;
};

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function zip(entries: Array<{ name: string; contents: string }>, corruptCrc = false) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  entries.forEach((entry, index) => {
    const name = Buffer.from(entry.name, "utf8");
    const contents = Buffer.from(entry.contents, "utf8");
    const compressed = deflateRawSync(contents);
    const checksum = (crc32(contents) ^ (corruptCrc && index === 0 ? 1 : 0)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  });
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function makeEmployeeXlsx(options: FixtureOptions = {}) {
  const rows = options.rows ?? [
    ["Full Name", "Email", "Department", "Role", "Employee ID", "Phone"],
    ["Zoë Example", "zoe@example.test", "Operations", "Employee", "0000123", "001-234"],
    ["", "", "", "", "", ""],
    ["李明", "li@example.test", "Operations", "Manager", "0000456", "009-876"],
  ];
  const sharedStringValues = [...new Set(rows.flat())];
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      if (options.numericIdentifier && rowIndex > 0 && columnIndex === 4) {
        return `<c r="${reference}"><v>123</v></c>`;
      }
      const valueXml = options.formula && rowIndex === 1 && columnIndex === 1
        ? `<f>1+1</f><v>${escaped}</v>`
        : options.sharedStrings
          ? `<v>${sharedStringValues.indexOf(value)}</v>`
          : `<is><t>${escaped}</t></is>`;
      return `<c r="${reference}" t="${options.sharedStrings ? "s" : "inlineStr"}">${valueXml}</c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const secondSheet = options.multipleSheets
    ? `<sheet name="Other" sheetId="2" r:id="rId2"/>`
    : "";
  const includesStyles = options.extraEntries?.some((entry) => entry.name === "xl/styles.xml") ?? false;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Employees" sheetId="1" r:id="rId1"/>${secondSheet}</sheets></workbook>`;
  const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${options.sharedStrings ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` : ""}${includesStyles ? `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` : ""}</Relationships>`;
  const contentTypes = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${options.sharedStrings ? `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` : ""}${includesStyles ? `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` : ""}</Types>`;
  const worksheetXml = options.worksheetXml
    ?? `${options.worksheetPrefix ?? ""}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(Math.max(...rows.map((row) => row.length)) - 1)}${rows.length}"/><sheetData>${sheetRows}</sheetData></worksheet>`;
  const rootRelationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>${options.externalRelationship ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="https://example.test/core.xml" TargetMode="External"/>` : ""}</Relationships>`;
  return zip([
    { name: "[Content_Types].xml", contents: contentTypes },
    { name: "_rels/.rels", contents: rootRelationships },
    { name: "xl/workbook.xml", contents: workbook },
    { name: "xl/_rels/workbook.xml.rels", contents: relationships },
    { name: "xl/worksheets/sheet1.xml", contents: options.malformedSheet ? "<worksheet>" : worksheetXml },
    ...(options.sharedStrings ? [{ name: "xl/sharedStrings.xml", contents: `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${rows.flat().length}" uniqueCount="${sharedStringValues.length}">${sharedStringValues.map((value) => `<si><t>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</t></si>`).join("")}</sst>` }] : []),
    ...(options.multipleSheets ? [{ name: "xl/worksheets/sheet2.xml", contents: worksheetXml }] : []),
    ...(options.extraEntries ?? []),
  ], options.corruptCrc);
}

export function makeCorruptZip() {
  return Buffer.from("PK\u0003\u0004not-a-valid-zip");
}
