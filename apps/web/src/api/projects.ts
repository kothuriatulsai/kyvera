import type { CreateProjectRequest, Project } from '@kyvera/shared-types'
import { apiGet, apiPost } from './client'

const enc = encodeURIComponent

export const fetchProjects = () => apiGet<Project[]>('/projects')

export const fetchProject = (id: string) => apiGet<Project>(`/projects/${enc(id)}`)

export const createProject = (body: CreateProjectRequest) => apiPost<Project>('/projects', body)
