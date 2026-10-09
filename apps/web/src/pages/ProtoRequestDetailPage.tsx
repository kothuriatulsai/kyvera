import { Link, useParams } from 'react-router'
import { fetchProtoRequest } from '../api/protoRequests'
import { AsyncView } from '../components/AsyncView'
import { DownloadAttachmentButton } from '../components/DownloadAttachmentButton'
import { useAsync } from '../hooks/useAsync'
import { formatDate } from '../lib/format'

export function ProtoRequestDetailPage() {
  const { id = '' } = useParams()

  // The pinned version's files and approval travel on the ProtoRequest
  // response itself (ADR 0013) - Finance/Merchandiser can't follow up with
  // GET /tech-packs/:id the way an earlier version of this page did; that
  // call 404s for them, since they never browse Tech Packs directly.
  const state = useAsync(() => fetchProtoRequest(id), id)

  return (
    <section>
      <p>
        <Link to="/proto-requests">← All proto requests</Link>
      </p>
      <AsyncView state={state}>
        {(protoRequest) => (
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
              {protoRequest.techPackVersion.approval && (
                <div>
                  <dt>Approved by</dt>
                  <dd>
                    {protoRequest.techPackVersion.approval.decidedBy.name} ·{' '}
                    {formatDate(protoRequest.techPackVersion.approval.decidedAt)}
                  </dd>
                </div>
              )}
            </dl>

            <h2>Files</h2>
            {protoRequest.techPackVersion.attachments.length > 0 ? (
              <ul>
                {protoRequest.techPackVersion.attachments.map((attachment) => (
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
