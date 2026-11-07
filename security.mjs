const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, size = 80) => typeof value === 'string' ? value.slice(0, size) : '';
const integer = (value, low, high, fallback = low) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(low, Math.min(high, Math.trunc(n))) : fallback;
};
export function normalizeState(input, defaults) {
  const source = record(input), cfg = record(source.cfg), fallback = defaults.cfg;
  const subjects = [...new Set((Array.isArray(cfg.subj) ? cfg.subj : fallback.subj)
    .filter(v => typeof v === 'string' && v.trim() && !forbidden.has(v)).map(v => v.slice(0, 16)))].slice(0, 40);
  const select = value => [...new Set((Array.isArray(value) ? value : []).filter(v => subjects.includes(v)))];
  const spec = select(cfg.spec), block = select(cfg.block).filter(v => !spec.includes(v));
  const out = { cfg: { nc: integer(cfg.nc, 1, 15, 7), subj: subjects, spec, block },
    week: text(source.week), periods: Array.from({length:5}, (_, i) => integer(source.periods?.[i], 0, 6, defaults.periods[i])),
    target: Object.create(null), teachers: Object.create(null), avail: Object.create(null),
    fixed: [], auto: [], seed: integer(source.seed, 1, 2147483647, 1), report: null };
  for (const s of subjects) out.target[s] = integer(record(source.target)[s], 0, 30);
  for (const s of spec) {
    out.teachers[s] = text(record(source.teachers)[s], 40);
    out.avail[s] = Array.from({length:5}, (_, d) => Array.from({length:6}, (_, p) => integer(record(source.avail)[s]?.[d]?.[p], 0, 2, 1)));
  }
  for (let c=0; c<out.cfg.nc; c++) {
    const fixed = Object.create(null), auto = Object.create(null);
    for (let k=0; k<30; k++) {
      const f = record(record(source.fixed)[c])[k];
      // Arrays are expected for per-class entries; never copy inherited or arbitrary keys.
      const rawFixed = Array.isArray(source.fixed) ? record(source.fixed[c])[k] : f;
      if (rawFixed && typeof rawFixed === 'object') {
        const s = subjects.includes(rawFixed.s) ? rawFixed.s : '';
        const l = text(rawFixed.l, 32);
        if (s || l) fixed[k] = {s, ...(l ? {l} : {})};
      }
      const a = Array.isArray(source.auto) ? record(source.auto[c])[k] : null;
      if (subjects.includes(a)) auto[k] = a;
    }
    out.fixed.push(fixed); out.auto.push(auto);
  }
  if (Array.isArray(source.report)) out.report = source.report.slice(0, 200).map(item => ({t: ['err','warn','ok'].includes(item?.t) ? item.t : 'warn', m: text(item?.m, 500)}));
  return out;
}
export function safeSpreadsheetText(value) {
  const str = String(value ?? '').replace(/[\t\r\n]/g, ' ');
  return /^[\s\uFEFF]*[=+@-]/.test(str) ? "'" + str : str;
}
export function tsvRows(rows) { return rows.map(row => row.map(v => typeof v === 'number' ? String(v) : safeSpreadsheetText(v)).join('\t')).join('\n'); }

const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const enc = new TextEncoder();
const table = Array.from({length:256}, (_, n) => { for(let k=0;k<8;k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = bytes => { let n = 0xffffffff; for(const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
function zip(files) {
  const chunks=[], central=[]; let offset=0, centralSize=0;
  for (const [name, text] of files) {
    const filename=enc.encode(name), data=enc.encode(text), crc=crc32(data);
    const local=new Uint8Array(30+filename.length), h=new DataView(local.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);
    h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,filename.length,true);local.set(filename,30);
    const entry=new Uint8Array(46+filename.length), d=new DataView(entry.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,33,true);
    d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);entry.set(filename,46);
    chunks.push(local,data);central.push(entry);offset+=local.length+data.length;centralSize+=entry.length;
  }
  const end=new Uint8Array(22), d=new DataView(end.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,files.length,true);d.setUint16(10,files.length,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);
  const out=new Uint8Array(offset+centralSize+end.length);let cursor=0;for(const chunk of [...chunks,...central,end]){out.set(chunk,cursor);cursor+=chunk.length;}return out;
}
const column = n => { let s=''; do { s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1; } while(n>=0); return s; };
export function workbookBytes(sheets) {
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const files=[['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`]];
  sheets.forEach((sheet,i)=>files.push([`xl/worksheets/sheet${i+1}.xml`,`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData>${sheet.rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>typeof v==='number'&&Number.isFinite(v)?`<c r="${column(c)}${r+1}"><v>${v}</v></c>`:`<c r="${column(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`]));
  return zip(files);
}
