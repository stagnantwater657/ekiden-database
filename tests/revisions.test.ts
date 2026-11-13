import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registry, batches } from '../data/index.ts';
import artifact from '../data/revisions/all-japan-2024-completeness.json' with {type:'json'};
import { previewRevision, makeRevision, revisionHash } from '../lib/revisions.ts';
import type { EditionRevision, RevisionChanges } from '../lib/revisions.ts';
import { validateImport } from '../lib/importer.ts';
const revision=artifact as EditionRevision;
const base=previewRevision(registry,batches,revision,'rollback');
const original=base.batches.find(b=>b.edition.id===revision.editionId)!;
const current=batches.find(b=>b.edition.id===revision.editionId)!;
const metadata={id:revision.id,editionId:revision.editionId,reason:revision.reason,createdAt:revision.createdAt};
const changes=():RevisionChanges=>structuredClone({entryTotals:revision.entryTotals,additions:revision.additions});

test('revision is a reviewable exact delta; replay and rollback reconstruct both verified states',()=>{
 const applied=previewRevision(base.registry,base.batches,revision);
 assert.deepEqual(applied.registry,registry);assert.deepEqual(applied.batches,batches);
 assert.equal(applied.report.changed,true);
 assert.deepEqual(applied.report.originalResults,{count:200,beforeSha256:revisionHash(original.results),afterSha256:revisionHash(original.results)});
 assert.equal(applied.report.entryTotals.length,25);assert.equal(applied.report.added.results.length,16);
 const repeated=previewRevision(registry,batches,revision);
 assert.equal(repeated.report.changed,false);assert.deepEqual(repeated.batches,batches);
 assert.deepEqual(previewRevision(base.registry,base.batches,revision,'rollback').batches,base.batches);
 // The existing import path still rejects changed same-ID editions.
 assert.throws(()=>validateImport(registry,base.batches,current),/Conflicting edition/);
 assert.deepEqual(original.results,current.results.slice(0,200));
 assert.deepEqual(original.identities,current.identities.slice(0,200));
});

test('revision rejects drift in either registry or edition, partial writes and tampered artifacts',()=>{
 const badBatch=structuredClone(base.batches);
 badBatch.find(b=>b.edition.id===revision.editionId)!.results[0].timeSeconds!++;
 assert.throws(()=>previewRevision(base.registry,badBatch,revision),/SHA256 mismatch/);
 const badRegistry=structuredClone(base.registry);badRegistry.athletes[0].name+='x';
 assert.throws(()=>previewRevision(badRegistry,base.batches,revision),/SHA256 mismatch/);
 assert.throws(()=>previewRevision(registry,base.batches,revision),/SHA256 mismatch/);
 const altered=structuredClone(revision);altered.additions.results[0].rank!++;
 assert.throws(()=>previewRevision(base.registry,base.batches,altered),/candidate SHA256 mismatch/);
 const extra={...revision,results:[]} as EditionRevision;
 assert.throws(()=>previewRevision(registry,batches,extra),/Invalid revision artifact fields/);
});

test('revision cannot replace old results, identities, registry IDs, final ranks or existing totals',()=>{
 for(const key of ['results','identities'] as const){
  const c=changes();
  if(key==='results')c.additions.results.push({...original.results[0],timeSeconds:1});
  else c.additions.identities.push({...original.identities[0],reason:'overwrite'});
  assert.throws(()=>makeRevision(base.registry,base.batches,metadata,c),/cannot replace existing/);
 }
 const c=changes();c.additions.registry.athletes.push({...base.registry.athletes[0],name:'overwrite'});
 assert.throws(()=>makeRevision(base.registry,base.batches,metadata,c),/new IDs/);
 const rank=structuredClone(revision);
 Object.assign(rank.entryTotals[0],{finalRank:2});
 assert.throws(()=>previewRevision(registry,batches,rank),/entry total fields/);
 assert.throws(()=>makeRevision(registry,batches,metadata,changes()),/only fill missing/);
});

test('legacy-edition exception cannot admit unsourced new rows or silently change final rank semantics',()=>{
 const missingLocation=changes();delete missingLocation.additions.results[0].locator;
 assert.throws(()=>makeRevision(base.registry,base.batches,metadata,missingLocation),/status, location/);
 const legacy=changes();legacy.additions.identities[0].status='legacy';
 assert.throws(()=>makeRevision(base.registry,base.batches,metadata,legacy),/non-legacy/);
 const source=changes();delete source.additions.sources[0].usage;
 assert.throws(()=>makeRevision(base.registry,base.batches,metadata,source),/source-use review/);
 const rank=changes();rank.additions.entries[0].finalRank=26;rank.additions.entries[0].finalRankSourceId=rank.additions.sources[0].id;
 assert.throws(()=>makeRevision(base.registry,base.batches,metadata,rank),/Non-official/);
 const total=changes();total.entryTotals[0].totalTimeSeconds++;
 assert.throws(()=>makeRevision(base.registry,base.batches,metadata,total),/Team total mismatch/);
});

test('CLI dry-run, actual rollback/apply, idempotent replay and drift refusal in isolated copy',()=>{
 const root=mkdtempSync(join(tmpdir(),'ekiden-revision-'));
 try{
  for(const dir of ['data','lib','scripts'])cpSync(dir,join(root,dir),{recursive:true});
  const path='data/editions/all-japan-2024.json';
  const read=(p:string)=>readFileSync(join(root,p),'utf8');
  const run=(...args:string[])=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',join(root,'scripts/data-revise.ts'),'--input','data/revisions/all-japan-2024-completeness.json',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const originalText=read(path);
  assert.equal(run('--rollback').changed,true);assert.equal(read(path),originalText);
  run('--rollback','--write');assert.equal(revisionHash(JSON.parse(read(path))),revision.beforeSha256);
  run('--write');assert.equal(read(path),originalText);
  assert.equal(run('--write').changed,false);assert.equal(read(path),originalText);
  const edited=JSON.parse(read(path));edited.results[0].rank++;
  writeFileSync(join(root,path),JSON.stringify(edited));
  assert.throws(()=>run('--write'),/SHA256 mismatch/);
  assert.equal(JSON.parse(read(path)).results[0].rank,edited.results[0].rank);
 }finally{rmSync(root,{recursive:true,force:true});}
});
