import * as assignmentRepository from "../repositories/assignmentRepository";
import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";
import { hasFullAccessToAnyProduct } from "./accessService";
import type { Actor } from "./tokenService";

/**
 * The workflow's stages, as far as this actor is allowed to know them.
 *
 * Stage definitions are global, but their *names* are exactly what an assignee
 * must not learn about stages that aren't theirs (ADR 0004), so listing them all
 * to everyone would undo the projection. An admin, and anyone who sees at least
 * one product in full (an owner or an assigned manager), gets every stage. An
 * assignee gets only the stages they are assigned to. ADR 0004 doesn't mention
 * this endpoint; this is the reading that keeps its confidentiality guarantee.
 */
export async function listStages(actor: Actor) {
  if (actor.role === "ADMIN" || (await hasFullAccessToAnyProduct(actor))) {
    return stageDefinitionRepository.findAll();
  }

  const assignments = await assignmentRepository.findByUser(actor.id);
  const byId = new Map(assignments.map((a) => [a.stage.id, a.stage]));
  return [...byId.values()].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
}
