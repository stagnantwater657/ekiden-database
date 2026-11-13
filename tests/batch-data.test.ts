import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, registry, batches } from '../data/index.ts';
import { validateImport } from '../lib/importer.ts';
import { assembleDatabase } from '../lib/data-assembly.ts';
import { formatTime } from '../lib/query.ts';
for(const [id,teams,results,ranks] of [['all-japan-2023',27,216,24],['all-japan-2026',27,216,25]] as const){
 test(`${id}: full official counts, independent facts, complete teams and repeatability`,()=>{
  const b=batches.find(b=>b.edition.id===id)!;
  assert.equal(b.entries.length,teams);assert.equal(b.results.length,results);assert.equal(b.entries.filter(e=>e.finalRank!==null).length,ranks);
  assert.doesNotThrow(()=>validateImport(registry,batches,b));
  assert.deepEqual(assembleDatabase(registry,[...batches,b]),database);
  const facts=JSON.parse(readFileSync(`data/imports/${id}-facts.json`,'utf8'));
  for(const f of facts){
   const e=b.entries.find(e=>e.id.endsWith(`-${String(f.bib).padStart(2,'0')}`))!;
   assert.equal(e.finalRank,f.rank);assert.equal(formatTime(e.totalTimeSeconds),f.total??'—');
   for(const r of f.results){
    const row=b.results.find(x=>x.entryId===e.id && b.sections.find(s=>s.id===x.sectionId)?.number===r.section)!;
    assert.equal(formatTime(row.timeSeconds),r.time??'—');assert.equal(row.rank,r.rank);assert.equal(row.status,r.status);
   }
  }
 });
}
test('2023 Tohoku Gakuin withdrawal retains later unranked reference legs without fabricated total',()=>{
 const b=batches.find(b=>b.edition.id==='all-japan-2023')!;const e=b.entries.find(e=>e.id==='aj23-entry-10')!;
 assert.equal(e.status,'did-not-finish');assert.equal(e.totalTimeSeconds,null);assert.equal(e.finalRank,null);
 const rows=b.results.filter(r=>r.entryId===e.id);assert.equal(rows.length,8);
 assert.equal(rows[4].timeSeconds,null);assert.equal(rows[4].status,'did-not-finish');
 assert.ok(rows.slice(5).every(r=>r.status==='reference' && r.rank===null && r.timeSeconds!==null));
});
