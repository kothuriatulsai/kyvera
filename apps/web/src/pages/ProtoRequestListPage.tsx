import { Link } from 'react-router'
import { fetchProtoRequests } from '../api/protoRequests'
import { AsyncView } from '../components/AsyncView'
import { useAsync } from '../hooks/useAsync'
import { formatDate } from '../lib/format'

export function ProtoRequestListPage() {
  const state = useAsync(() => fetchProtoRequests())

  return (
    <section>
      <h1>Proto Requests</h1>
      <AsyncView state={state}>
        {(protoRequests) =>
          protoRequests.length === 0 ? (
            <p className="muted">No proto requests yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Project</th>
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
                      <Link to={`/projects/${protoRequest.project.id}`}>{protoRequest.project.name}</Link>
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
          )
        }
      </AsyncView>
    </section>
  )
}
