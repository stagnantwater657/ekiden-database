import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ResearchAuthorization } from "./research-authorization.ts";
import type { ResearchBatch } from "./research.ts";
import { validateCompletionClaim, type CompletionPlan } from "./research-completion.ts";

export function readCompletionPlans(directory: string, batches: ResearchBatch[], authorization?: ResearchAuthorization) {
  return readdirSync(directory).filter((file)=>file.endsWith(".json")).sort().map((file)=>{
    const plan=JSON.parse(readFileSync(join(directory,file),"utf8")) as CompletionPlan;
    const batch=batches.find((b)=>b.batchId===plan.batchId);
    if (!batch || file!==`${plan.batchId}.json`) throw new Error("Completion plan must reference an existing batch and match filename");
    return {plan,report:validateCompletionClaim(plan,batch,authorization?.batchId===batch.batchId ? authorization : undefined)};
  });
}
