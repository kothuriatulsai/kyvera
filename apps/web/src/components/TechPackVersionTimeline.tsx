import type { TechPackDetail } from '@kyvera/shared-types'
import { useAuth } from '../auth/useAuth'
import { formatDate } from '../lib/format'
import { canRemark } from '../lib/sopPermissions'
import { DownloadAttachmentButton } from './DownloadAttachmentButton'
import { RemarkThread } from './RemarkThread'

interface TechPackVersionTimelineProps {
  techPack: TechPackDetail
  /** Reload the page's data after a remark is posted. */
  onChanged: () => Promise<void>
}

/** Newest first, as the API already returns them. Each version carries its
 * own status badges, files and remark thread - there is no separate "current
 * version" the way the old module has; every version stays visible. */
export function TechPackVersionTimeline({ techPack, onChanged }: TechPackVersionTimelineProps) {
  const { session } = useAuth()
  const canPost = session !== null && canRemark(session.user.role, techPack)

  if (techPack.versions.length === 0) {
    return <p className="muted">No versions yet.</p>
  }

  return (
    <ul className="versions">
      {techPack.versions.map((version, index) => (
        <li key={version.id}>
          <h3>
            v{version.versionNumber}{' '}
            {index === 0 && <span className="badge badge-latest">Latest</span>}{' '}
            {version.confirmation && (
              <span className="badge badge-confirmed">Confirmed by {version.confirmation.confirmedBy.name}</span>
            )}{' '}
            {version.approval?.decision === 'APPROVED' && <span className="badge badge-approved">Approved</span>}
            {version.approval?.decision === 'REJECTED' && <span className="badge badge-rejected">Rejected</span>}
          </h3>
          <p className="muted">
            {version.uploadedBy.name} · {formatDate(version.uploadedAt)}
          </p>
          {version.notes && <p>{version.notes}</p>}
          {version.attachments.length > 0 && (
            <ul>
              {version.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <DownloadAttachmentButton attachment={attachment} />
                </li>
              ))}
            </ul>
          )}
          <RemarkThread
            techPackId={techPack.id}
            versionNumber={version.versionNumber}
            remarks={version.remarks}
            canPost={canPost}
            onPosted={onChanged}
          />
        </li>
      ))}
    </ul>
  )
}
