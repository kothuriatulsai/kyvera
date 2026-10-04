import { Link, useParams } from 'react-router'
import { fetchTechPack } from '../api/techPacks'
import { AsyncView } from '../components/AsyncView'
import { TechPackActions } from '../components/TechPackActions'
import { TechPackVersionTimeline } from '../components/TechPackVersionTimeline'
import { useAsyncWithReload } from '../hooks/useAsync'

export function TechPackDetailPage() {
  const { id = '' } = useParams()
  const { state, reload } = useAsyncWithReload(() => fetchTechPack(id), id)

  return (
    <section>
      <AsyncView state={state}>
        {(techPack) => (
          <>
            <p>
              <Link to={`/projects/${techPack.project.id}`}>← {techPack.project.name}</Link>
            </p>
            <header className="detail-header">
              <h1>{techPack.code}</h1>
            </header>

            {techPack.voidedAt && (
              <p className="notice">
                Voided{techPack.voidReason ? ` — ${techPack.voidReason}` : ''}.{' '}
                {techPack.supersededBy && (
                  <>
                    Continue on{' '}
                    <Link to={`/tech-packs/${techPack.supersededBy.id}`}>{techPack.supersededBy.code}</Link>.
                  </>
                )}
              </p>
            )}

            {!techPack.voidedAt && <TechPackActions techPack={techPack} onChanged={reload} />}

            <h2>Versions</h2>
            <TechPackVersionTimeline techPack={techPack} onChanged={reload} />
          </>
        )}
      </AsyncView>
    </section>
  )
}
