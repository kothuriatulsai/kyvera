import { Link, useNavigate, useParams } from 'react-router'
import { fetchProject } from '../api/projects'
import { fetchProtoRequests } from '../api/protoRequests'
import { fetchTechPacks } from '../api/techPacks'
import { AsyncView } from '../components/AsyncView'
import { CreateTechPackForm } from '../components/CreateTechPackForm'
import { useAuth } from '../auth/useAuth'
import { useAsync } from '../hooks/useAsync'
import { formatDate, PROJECT_PHASE_LABELS, PROJECT_STATUS_LABELS } from '../lib/format'
import { canCreateTechPack } from '../lib/sopPermissions'
import { successorOf, sortTechPacks } from '../lib/techPacks'

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const navigate = useNavigate()

  const state = useAsync(async () => {
    const [project, techPacks, protoRequests] = await Promise.all([
      fetchProject(id),
      fetchTechPacks(id),
      fetchProtoRequests(id),
    ])
    return { project, techPacks: sortTechPacks(techPacks), protoRequests }
  }, id)

  return (
    <section>
      <p>
        <Link to="/projects">← All projects</Link>
      </p>
      <AsyncView state={state}>
        {({ project, techPacks, protoRequests }) => (
          <>
            <header className="detail-header">
              <h1>{project.name}</h1>
            </header>
            <dl className="facts">
              <div>
                <dt>Code</dt>
                <dd>{project.code}</dd>
              </div>
              <div>
                <dt>Product</dt>
                <dd>{project.productName}</dd>
              </div>
              <div>
                <dt>Phase</dt>
                <dd>{PROJECT_PHASE_LABELS[project.phase]}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{PROJECT_STATUS_LABELS[project.status]}</dd>
              </div>
            </dl>

            <h2>Tech packs</h2>
            {techPacks.length === 0 ? (
              <p className="muted">No tech packs yet.</p>
            ) : (
              <ul className="versions">
                {techPacks.map((techPack) => {
                  const voided = techPack.voidedAt !== null
                  const successor = voided ? successorOf(techPack, techPacks) : undefined
                  return (
                    <li key={techPack.id} className={voided ? 'muted' : undefined}>
                      <Link to={`/tech-packs/${techPack.id}`}>{techPack.code}</Link>
                      {voided && (
                        <>
                          {' '}
                          — voided
                          {successor && (
                            <>
                              {' '}
                              — superseded by <Link to={`/tech-packs/${successor.id}`}>{successor.code}</Link>
                            </>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {session && canCreateTechPack(session.user.role, project, techPacks) && (
              <CreateTechPackForm
                projectId={project.id}
                onCreated={(techPack) => navigate(`/tech-packs/${techPack.id}`)}
              />
            )}

            <h2>Proto requests</h2>
            {protoRequests.length === 0 ? (
              <p className="muted">No proto requests yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Tech pack</th>
                    <th>Version</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {protoRequests.map((protoRequest) => (
                    <tr key={protoRequest.id}>
                      <td>
                      <Link to={`/proto-requests/${protoRequest.id}`}>{protoRequest.code}</Link>
                    </td>
                      <td>
                        <Link to={`/tech-packs/${protoRequest.techPackVersion.techPack.id}`}>
                          {protoRequest.techPackVersion.techPack.code}
                        </Link>
                      </td>
                      <td>v{protoRequest.techPackVersion.versionNumber}</td>
                      <td>{formatDate(protoRequest.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </AsyncView>
    </section>
  )
}
