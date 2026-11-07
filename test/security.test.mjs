import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeState, tsvRows, workbookBytes } from '../security.mjs';
import { createAppServer } from '../server.mjs';
const defaults={cfg:{nc:7,subj:['국어','영어'],spec:['영어'],block:[]},periods:[5,6,5,5,5]};

test('untrusted saved state is reconstructed and bounded before rendering',()=>{
  const input=JSON.parse('{"cfg":{"nc":999,"subj":["constructor","__proto__","국어","영어"],"spec":["영어"]},"target":{"국어":"<img src=x onerror=alert(1)>","영어":99999},"periods":[99,-1,5,6,4],"avail":{"영어":[["bad"]]},"fixed":[{"0":{"s":"국어","l":"</span><script>x</script>"},"999":{"s":"국어"}}]}');
  const result=normalizeState(input,defaults);
  assert.equal(result.cfg.nc,15);assert.deepEqual(result.cfg.subj,['국어','영어']);
  assert.equal(result.target.국어,0);assert.equal(result.target.영어,30);
  assert.deepEqual(result.periods,[6,0,5,6,4]);assert.equal(result.avail.영어[0][0],1);
  assert.equal(result.fixed[0][999],undefined);assert.equal(Object.getPrototypeOf(result.target),null);
});
test('clipboard exports neutralize formula starts and embedded cell separators',()=>{
  const out=tsvRows([['=1+1',' +SUM(A1)','@cmd','-evil','x\ty\nz',3]]);
  assert.equal(out,"'=1+1\t' +SUM(A1)\t'@cmd\t'-evil\tx y z\t3");
});
function unzipStored(bytes){
  const files=new Map(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let pos=0;
  while(view.getUint32(pos,true)===0x04034b50){
    assert.equal(view.getUint16(pos+8,true),0);
    const size=view.getUint32(pos+18,true),nl=view.getUint16(pos+26,true),el=view.getUint16(pos+28,true),start=pos+30+nl+el;
    files.set(new TextDecoder().decode(bytes.slice(pos+30,pos+30+nl)),new TextDecoder().decode(bytes.slice(start,start+size)));pos=start+size;
  }
  assert.equal(view.getUint32(pos,true),0x02014b50);return files;
}
test('xlsx has escaped inline text, valid package parts, and no formulas or external relationships',()=>{
  const bytes=workbookBytes([{name:'시간표',rows:[['=HYPERLINK("https://invalid")','<script>&',3]]},{name:'전담시간표',rows:[['영어']]}]);
  const files=unzipStored(bytes),sheet=files.get('xl/worksheets/sheet1.xml');
  assert.ok(files.has('[Content_Types].xml'));assert.ok(files.has('xl/workbook.xml'));
  assert.match(sheet,/t="inlineStr"/);assert.match(sheet,/&lt;script&gt;&amp;/);assert.ok(!sheet.includes('<f>'));
  assert.ok(!files.get('xl/_rels/workbook.xml.rels').includes('TargetMode="External"'));
});
test('app treats toast text as text and has no external/cloud code path',async()=>{
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function say('),source.indexOf("$('cfgBox').open",source.indexOf('function say(')));
  const elements={report:{},toast:{}};
  vm.runInNewContext(body+`;say('<img src=x onerror=alert(1)>');`,{$:id=>elements[id],setTimeout:()=>1,clearTimeout:()=>{}});
  assert.equal(elements.report.textContent,'<img src=x onerror=alert(1)>');assert.equal(elements.report.innerHTML,undefined);
  assert.ok(!source.includes('window.claude'));assert.ok(!source.includes('fetch('));
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(!/https?:\/\//.test(html));assert.ok(!html.includes('<script>'));
});
test('static server restricts served paths and blocks script/network injection with headers',async t=>{
  const server=await createAppServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const index=await fetch(base);assert.equal(index.status,200);assert.match(index.headers.get('content-security-policy'),/connect-src 'none'/);assert.match(index.headers.get('content-security-policy'),/script-src 'self';/);
  assert.equal((await fetch(base+'/healthz')).status,200);
  for(const route of ['/.git/config','/server.mjs','/package.json','/.env','/test/security.test.mjs'])assert.equal((await fetch(base+route)).status,404);
  assert.equal((await fetch(base,{method:'POST',body:'private'})).status,405);
});
