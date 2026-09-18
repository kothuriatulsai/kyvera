import * as stageDefinitionRepository from "../repositories/stageDefinitionRepository";

export function listStages() {
  return stageDefinitionRepository.findAll();
}
