import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { database, registry, batches } from '../data/index.ts';
import legacy from '../data/all-japan-2024.json' with {type:'json'};
import facts from '../data/imports/all-japan-2024-completion-facts.json' with {type:'json'};
import preservation from '../data/revisions/all-japan-2024-preservation.json' with {type:'json'};
import audit from '../data/imports/all-japan-2024-identity-audit.json' with {type:'json'};
import { validateImport } from '../lib/importer.ts';
import { createFileRepository } from '../lib/repository.ts';
import { parseFilters } from '../lib/query.ts';
const batch = batches.find(b => b.edition.id === 'all-japan-2024')!;

test('56th All Japan completeness: 27 teams / 216 records, all 11 editions and 2030 records validate', () => {
  assert.equal(batches.length,11); assert.equal(database.results.length,2030);
  assert.equal(batch.entries.length,27); assert.equal(batch.results.length,216);
  for (const b of batches) assert.doesNotThrow(() => validateImport(registry,batches,b));
  assert.equal(batch.entries.filter(e => e.finalRank!==null).length,25);
  for (const original of legacy.results) assert.deepEqual(batch.results.find(r=>r.id===original.id),original);
  for (const e of legacy.entries) {
    const now=batch.entries.find(r=>r.id===e.id)!;
    assert.deepEqual([now.finalRank,now.finalRankSourceId],[e.finalRank,e.finalRankSourceId]);
    const official=facts.totals.find(f=>f.rank===e.finalRank)!;
    assert.equal(now.totalTimeSeconds,official.totalTimeSeconds);
    assert.equal(now.totalTimeSourceId,'iuau-aj2024-completion-results');
    assert.equal(batch.results.filter(r=>r.entryId===e.id).reduce((n,r)=>n+r.timeSeconds!,0),now.totalTimeSeconds);
  }
  for(const [file,hash] of Object.entries(preservation.untouchedFiles))
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,file);
});

test('both selection teams keep official section ranks and source locators but never get overall ranks', async () => {
  const repo=createFileRepository(database);
  for(const f of facts.selections){
    const teamId=f.bib===26?'team-japan-selection':'team-tokai-selection';
    const entry=batch.entries.find(e=>e.teamId===teamId)!;
    assert.equal(entry.status,'reference');assert.equal(entry.rankingEligibility,'reference');
    assert.equal(entry.universityId,null);assert.equal(entry.finalRank,null);assert.equal(entry.finalRankSourceId,null);
    assert.equal(entry.totalTimeSeconds,f.bib===26?19291:19940);
    const found=await repo.search(parseFilters({race:'all-japan',year:'2024',team:teamId,view:'university'}));
    assert.equal(found.total,8);
    assert.deepEqual(found.rows.map(r=>r.section.number),[1,2,3,4,5,6,7,8]);
    for(const official of f.results){
      const row=found.rows.find(r=>r.section.number===official.section)!;
      assert.equal(row.timeSeconds,official.timeSeconds);assert.equal(row.rank,official.rank);
      assert.equal(row.status,'reference');assert.ok(row.locator?.includes(official.detailLocator));
      assert.equal(row.athlete.name,official.name);assert.ok(row.grade);assert.ok(row.representingUniversityId);
    }
    assert.deepEqual(new Set(found.sources.map(s=>s.id)),new Set(['iuau-aj2024-completion-results','iuau-aj2024-completion-affiliations']));
  }
  const third=batch.results.filter(r=>r.sectionId==='aj24-s3' && r.rank===8);
  assert.equal(third.length,2); // official tied rank8, not reranked after adding bib26
});

test('all 16 identity decisions have explicit evidence; existing identities and candidates are not merged', () => {
  assert.equal(audit.athletes.length,16);
  const originalIds=new Set(database.results.filter(r=>!audit.athletes.some(a=>a.recordId===r.id)).map(r=>r.athleteId));
  const reused=audit.athletes.filter(a=>originalIds.has(a.athleteId));
  assert.equal(reused.length,12);
  assert.equal(audit.athletes.filter(a=>!originalIds.has(a.athleteId)).length,4);
  for(const a of audit.athletes){
    const row=batch.results.find(r=>r.id===a.recordId)!;
    const decision=batch.identities.find(i=>i.recordId===a.recordId)!;
    assert.equal(row.athleteId,a.athleteId);assert.equal(row.grade,a.grade);
    assert.equal(row.representingUniversityId,a.universityId);
    assert.equal(decision.status,a.reused?'confirmed':'new');
    assert.ok(decision.evidenceSourceIds.includes('iuau-aj2024-completion-affiliations'));
    if(a.reused)assert.ok(decision.evidenceSourceIds.length>=3);
  }
  assert.equal(batch.results.find(r=>r.id==='aj24-japan-selection-s2')!.athleteId,'athlete-hk25-21-1');
  assert.equal(batch.results.find(r=>r.id==='aj24-tokai-selection-s6')!.athleteId,'athlete-aj25-19-8');
  assert.equal(database.identities.find(i=>i.recordId==='iz24-result-14-1')!.status,'needs-review');
});
