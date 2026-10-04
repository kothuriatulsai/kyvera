import { Link, useNavigate } from 'react-router'
import { fetchProjects } from '../api/projects'
import { AsyncView } from '../components/AsyncView'
import { NewProjectForm } from '../components/NewProjectForm'
import { useAuth } from '../auth/useAuth'
import { useAsync } from '../hooks/useAsync'
import { PROJECT_PHASE_LABELS, PROJECT_STATUS_LABELS } from '../lib/format'
import { canCreateProject } from '../lib/sopPermissions'

export function ProjectListPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const state = useAsync(fetchProjects)

  return (
    <section>
      <h1>Projects</h1>
      <AsyncView state={state}>
        {(projects) =>
          projects.length === 0 ? (
            <p className="muted">No projects yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Product</th>
                  <th>Phase</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link to={`/projects/${project.id}`}>{project.code}</Link>
                    </td>
                    <td>{project.name}</td>
                    <td>{project.productName}</td>
                    <td>{PROJECT_PHASE_LABELS[project.phase]}</td>
                    <td>{PROJECT_STATUS_LABELS[project.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </AsyncView>

      {session && canCreateProject(session.user.role) && (
        <NewProjectForm onCreated={(project) => navigate(`/projects/${project.id}`)} />
      )}
    </section>
  )
}
