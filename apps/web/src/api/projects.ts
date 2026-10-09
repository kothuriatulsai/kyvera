import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  Project,
  ProjectMember,
  UserSummary,
} from '@kyvera/shared-types'
import { apiGet, apiPost } from './client'

const enc = encodeURIComponent

export const fetchProjects = () => apiGet<Project[]>('/projects')

export const fetchProject = (id: string) => apiGet<Project>(`/projects/${enc(id)}`)

export const createProject = (body: CreateProjectRequest) => apiPost<Project>('/projects', body)

export const fetchProjectMembers = (projectId: string) =>
  apiGet<ProjectMember[]>(`/projects/${enc(projectId)}/members`)

/** PMO/ADMIN only - active users not already a member, and not a see-all
 * role (ADMIN/PMO/MANAGEMENT already see every Project, so they're not
 * eligible to be added either - the server filters this, not the UI). */
export const fetchMembershipCandidates = (projectId: string) =>
  apiGet<UserSummary[]>(`/projects/${enc(projectId)}/members/candidates`)

export const addProjectMember = (projectId: string, body: AddProjectMemberRequest) =>
  apiPost<ProjectMember>(`/projects/${enc(projectId)}/members`, body)

export const removeProjectMember = (projectId: string, userId: string) =>
  apiPost<void>(`/projects/${enc(projectId)}/members/${enc(userId)}/remove`)
