import { registry as allRegistry, batches as allBatches } from '../../data/index.ts';
import { assembleDatabase } from '../../lib/data-assembly.ts';
import type { Registry } from '../../lib/model.ts';
export const batches=allBatches.filter(b=>['all-japan-2024','all-japan-2025'].includes(b.edition.id));
const sourceIds=new Set(['official-2024','official-2024-final',...batches.flatMap(b=>b.sources.map(s=>s.id))]);
// Original shared sources remain unchanged; retain only phase-one entity provenance.
for(const s of allRegistry.sources) sourceIds.add(s.id);
export const registry=Object.fromEntries(Object.entries(allRegistry).map(([key,items])=>[key,key==='sources'?items:(items as {sourceId:string}[]).filter(x=>sourceIds.has(x.sourceId))])) as Registry;
export const database=assembleDatabase(registry,batches);
