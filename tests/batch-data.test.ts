import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, registry, batches } from '../data/index.ts';
import { validateImport } from '../lib/importer.ts';
import { assembleDatabase } from '../lib/data-assembly.ts';
import { normalizeName } from '../lib/identity.ts';
import { formatTime } from '../lib/query.ts';
for(const [id,teams,results,ranks] of [['all-japan-2023',27,216,24],['all-japan-2026',27,216,25],['izumo-2023',21,126,19],['izumo-2024',21,126,21],['izumo-2025',22,132,21],['izumo-2026',22,132,21],['hakone-2024',23,230,23],['hakone-2025',21,210,20],['hakone-2026',21,210,20]] as const){
 test(`${id}: full official counts, independent facts, complete teams and repeatability`,()=>{
  const b=batches.find(b=>b.edition.id===id)!;
  assert.equal(b.entries.length,teams);assert.equal(b.results.length,results);assert.equal(b.entries.filter(e=>e.finalRank!==null).length,ranks);
  assert.doesNotThrow(()=>validateImport(registry,batches,b));
  assert.deepEqual(assembleDatabase(registry,[...batches,b]),database);
  const facts=JSON.parse(readFileSync(`data/imports/${id}-facts.json`,'utf8'));
  for(const f of facts){
   const e=b.entries.find(e=>e.id.endsWith(`-${String(f.bib).padStart(2,'0')}`))!;
   assert.equal(e.finalRank,f.rank);assert.equal(formatTime(e.totalTimeSeconds),f.total??'—');
   if (id.startsWith('hakone-')) {
    assert.equal(e.stages?.length,2);
    const outbound=e.stages!.find(stage=>stage.kind==='outbound')!;
    const returning=e.stages!.find(stage=>stage.kind==='return')!;
    assert.deepEqual([outbound.firstSection,outbound.lastSection],[1,5]);
    assert.deepEqual([returning.firstSection,returning.lastSection],[6,10]);
    assert.equal(formatTime(outbound.timeSeconds),f.outbound);
    assert.equal(formatTime(returning.timeSeconds),f.returnTime);
    assert.equal(outbound.timeSeconds+returning.timeSeconds,e.totalTimeSeconds);
   }
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

test('Hakone stages reject offsets even if the full-race total is unchanged',()=>{
 const original=batches.find(batch=>batch.edition.id==='hakone-2024')!;
 const candidate=structuredClone(original);
 const entry=candidate.entries[0];
 const before=entry.totalTimeSeconds;
 entry.stages![0].timeSeconds+=1;
 entry.stages![1].timeSeconds-=1;
 assert.equal(entry.stages!.reduce((sum,stage)=>sum+stage.timeSeconds,0),before);
 assert.throws(()=>validateImport(registry,batches.filter(batch=>batch!==original),candidate),/Official stage time mismatch/);
 assert.equal(original.entries[0].totalTimeSeconds,before);
});

test('Hakone official stage metadata requires a traceable source and nonduplicated route',()=>{
 const original=batches.find(batch=>batch.edition.id==='hakone-2024')!;
 const remaining=batches.filter(batch=>batch!==original);
 const unknownSource=structuredClone(original);
 unknownSource.entries[0].stages![0].sourceId='missing-stage-source';
 assert.throws(()=>validateImport(registry,remaining,unknownSource),/Invalid official stage result/);
 const duplicate=structuredClone(original);
 duplicate.entries[0].stages!.push(structuredClone(duplicate.entries[0].stages![0]));
 assert.throws(()=>validateImport(registry,remaining,duplicate),/Invalid official stage result/);
});

test('Hakone reference team keeps stage times without manufactured stage or final ranks',()=>{
 const original=batches.find(batch=>batch.edition.id==='hakone-2025')!;
 const reference=original.entries.find(entry=>entry.status==='reference')!;
 assert.equal(reference.finalRank,null);
 assert.equal(reference.stages?.length,2);
 assert.ok(reference.stages!.every(stage=>stage.rank===null && stage.timeSeconds>0));
 assert.equal(original.results.filter(row=>row.entryId===reference.id).length,10);
 const candidate=structuredClone(original);
 candidate.entries.find(entry=>entry.id===reference.id)!.stages![0].rank=1;
 assert.throws(()=>validateImport(registry,batches.filter(batch=>batch!==original),candidate),/Invalid official stage result/);
});

test('audited roster whitespace and Unicode variants preserve verified identity without guessing near names',()=>{
 const aj=batches.find(b=>b.edition.id==='all-japan-2023')!;
 const rows=aj.results.filter(r=>r.entryId==='aj23-entry-23');
 assert.deepEqual(rows.slice(1).map(r=>r.grade),['4','3','1','4','2','3','4']);
 assert.equal(rows[3].athleteId,'athlete-aj25-23-2');
 const iz=batches.find(b=>b.edition.id==='izumo-2023')!;
 assert.equal(iz.results.find(r=>r.id==='iz23-result-11-3')!.athleteId,'athlete-aj24-06-3');
 const recent=batches.find(b=>b.edition.id==='izumo-2026')!;
 const ambiguous=recent.identities.find(i=>i.recordId==='iz26-result-20-1')!;
 assert.equal(ambiguous.status,'needs-review');
 assert.ok(ambiguous.candidateIds.length>0);
 assert.ok(!ambiguous.candidateIds.includes(ambiguous.athleteId));
});

test('decomposed Japanese voiced mark normalizes only for identity candidate lookup',()=>{assert.equal(normalizeName('ウ゛ィクター キムタイ'),normalizeName('ヴィクター キムタイ'));});
