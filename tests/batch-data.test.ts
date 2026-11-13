import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, registry, batches } from '../data/index.ts';
import { validateImport } from '../lib/importer.ts';
import { assembleDatabase } from '../lib/data-assembly.ts';
import { formatTime } from '../lib/query.ts';
for(const [id,teams,results,ranks] of [['all-japan-2023',27,216,24],['all-japan-2026',27,216,25],['izumo-2023',21,126,19],['izumo-2024',21,126,21],['izumo-2025',22,132,21],['izumo-2026',22,132,21]] as const){
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

test('Izumo official selection ranks are edition-specific and revised disqualifications stay empty',()=>{
 const b=batches.find(b=>b.edition.id==='izumo-2023')!;
 const soka=b.entries.find(e=>e.universityId==='soka')!;
 assert.equal(soka.status,'disqualified');assert.equal(soka.finalRank,null);
 assert.ok(b.results.filter(r=>r.entryId===soka.id).every(r=>r.status==='disqualified' && r.timeSeconds===null && r.rank===null));
 const ivy=b.entries.find(e=>database.teams.find(t=>t.id===e.teamId)?.kind==='overseas-selection')!;
 assert.equal(ivy.finalRank,12);assert.equal(ivy.rankingEligibility,'official');
 const invalid=structuredClone(b);invalid.entries.find(e=>e.id===ivy.id)!.rankingEligibility='reference';
 assert.throws(()=>validateImport(registry,batches.filter(x=>x!==b),invalid),/Non-official/);
 const opn=batches.find(b=>b.edition.id==='izumo-2025')!.entries.find(e=>e.status==='reference')!;
 assert.equal(opn.finalRank,null);assert.equal(opn.rankingEligibility,'reference');
});
