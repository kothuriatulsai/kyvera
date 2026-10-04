import { Link, useParams } from 'react-router'
import { fetchProtoRequest } from '../api/protoRequests'
import { fetchTechPack } from '../api/techPacks'
import { AsyncView } from '../components/AsyncView'
import { DownloadAttachmentButton } from '../components/DownloadAttachmentButton'
import { useAsync } from '../hooks/useAsync'
import { formatDate } from '../lib/format'

export function ProtoRequestDetailPage() {
  const { id = '' } = useParams()

  const state = useAsync(async () => {
    const protoRequest = await fetchProtoRequest(id)
    // The pinned version's files and approval aren't on the ProtoRequest
    // response itself (it only carries the version number) - the TechPack's
    // own detail already has both, nested per version, so there's no need
    // for the API to duplicate that data onto ProtoRequest as well.
    const techPack = await fetchTechPack(protoRequest.techPackVersion.techPack.id)
    const version = techPack.versions.find((v) => v.versionNumber === protoRequest.techPackVersion.versionNumber)
    return { protoRequest, version }
  }, id)

  return (
    <section>
      <p>
        <Link to="/proto-requests">← All proto requests</Link>
      </p>
      <AsyncView state={state}>
        {({ protoRequest, version }) => (
          <>
            <header className="detail-header">
              <h1>{protoRequest.code}</h1>
            </header>
            <dl className="facts">
              <div>
                <dt>Project</dt>
                <dd>
                  <Link to={`/projects/${protoRequest.project.id}`}>{protoRequest.project.name}</Link>
                </dd>
              </div>
              <div>
                <dt>Tech pack</dt>
                <dd>
                  <Link to={`/tech-packs/${protoRequest.techPackVersion.techPack.id}`}>
                    {protoRequest.techPackVersion.techPack.code}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>v{protoRequest.techPackVersion.versionNumber}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(protoRequest.createdAt)}</dd>
              </div>
              {version?.approval && (
                <div>
                  <dt>Approved by</dt>
                  <dd>
                    {version.approval.decidedBy.name} · {formatDate(version.approval.decidedAt)}
                  </dd>
                </div>
              )}
            </dl>

            <h2>Files</h2>
            {version && version.attachments.length > 0 ? (
              <ul>
                {version.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <DownloadAttachmentButton attachment={attachment} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No files on this version.</p>
            )}
          </>
        )}
      </AsyncView>
    </section>
  )
}
