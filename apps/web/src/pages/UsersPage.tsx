import { fetchUsers } from '../api/users'
import { AsyncView } from '../components/AsyncView'
import { NewUserForm } from '../components/NewUserForm'
import { UserRow } from '../components/UserRow'
import { useAsyncWithReload } from '../hooks/useAsync'

/** ADMIN-only (ADR 0010/0011): the server enforces this on every request
 * below, same as every other role-gated screen - see lib/sopPermissions.ts's
 * doc comment. Reached via the "Users" nav link, shown only to ADMIN. */
export function UsersPage() {
  const { state, reload } = useAsyncWithReload(fetchUsers)

  return (
    <section>
      <h1>Users</h1>
      <AsyncView state={state}>
        {(users) =>
          users.length === 0 ? (
            <p className="muted">No users yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Projects</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow key={user.id} user={user} onChanged={reload} />
                ))}
              </tbody>
            </table>
          )
        }
      </AsyncView>

      <NewUserForm onCreated={reload} />
    </section>
  )
}
