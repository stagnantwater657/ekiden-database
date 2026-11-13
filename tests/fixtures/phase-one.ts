import { registry as allRegistry, batches as allBatches } from '../../data/index.ts';
import { assembleDatabase } from '../../lib/data-assembly.ts';
import type { Registry } from '../../lib/model.ts';
import legacy from '../../data/all-japan-2024.json' with { type: 'json' };
const originalEntries = new Set(legacy.entries.map(entry => entry.id));
const originalResults = new Set(legacy.results.map(result => result.id));
// Keep the original 416-record statistical fixture; full current coverage is
// tested independently in completeness.test.ts, including the added teams.
export const batches=allBatches.filter(b=>['all-japan-2024','all-japan-2025'].includes(b.edition.id)).map(batch =>
  batch.edition.id !== 'all-japan-2024' ? batch : {
    ...batch,
    sources: [],
    entries: batch.entries.filter(entry => originalEntries.has(entry.id)).map(entry => ({ ...entry, totalTimeSeconds: null, totalTimeSourceId: null })),
    results: batch.results.filter(result => originalResults.has(result.id)),
    identities: batch.identities.filter(identity => originalResults.has(identity.recordId)),
  });
const sourceIds=new Set(['official-2024','official-2024-final',...batches.flatMap(b=>b.sources.map(s=>s.id))]);
// Original shared sources remain unchanged; retain only phase-one entity provenance.
for(const s of allRegistry.sources) sourceIds.add(s.id);
export const registry=Object.fromEntries(Object.entries(allRegistry).map(([key,items])=>[key,key==='sources'?items:(items as {sourceId:string}[]).filter(x=>sourceIds.has(x.sourceId))])) as Registry;
export const database=assembleDatabase(registry,batches);
