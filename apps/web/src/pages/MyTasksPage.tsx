import { Link } from 'react-router'
import { fetchMyTasks } from '../api/tasks'
import { AsyncView } from '../components/AsyncView'
import { useAsync } from '../hooks/useAsync'

/** ADR 0014: home page for every role. Computed, never stored - every item
 * here is something this viewer can already open (built on top of
 * services/visibility.ts), so there's nothing to gate in the UI beyond
 * rendering whatever the API sends back. */
export function MyTasksPage() {
  const state = useAsync(fetchMyTasks)

  return (
    <section>
      <h1>My tasks</h1>
      <AsyncView state={state}>
        {(tasks) =>
          tasks.length === 0 ? (
            <p className="muted">No tasks right now.</p>
          ) : (
            <ul className="task-list">
              {tasks.map((task, index) => (
                <li key={`${task.link}-${index}`}>
                  <Link to={task.link}>{task.message}</Link>
                  <span className="muted"> ({task.projectCode})</span>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
    </section>
  )
}
