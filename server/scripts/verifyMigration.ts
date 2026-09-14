// Applies the two-faces schema migrations (idempotent) and verifies the shape
// against the connected history database. Safe to re-run at any time.
//
//   cd server && bun run scripts/verifyMigration.ts
import { ensureInitialized, withHistoryStore } from "../src/lib/supabaseHistory"

async function main() {
  await ensureInitialized()
  console.log("ensureInitialized() applied (idempotent).")

  const result = await withHistoryStore(async (db) => {
    const columns = await db`
      select table_name, column_name, data_type, column_default
      from information_schema.columns
      where table_name in ('users', 'students')
        and column_name in ('role', 'account_auth0_id')
      order by table_name, column_name;
    `

    const constraints = await db`
      select conname
      from pg_constraint
      where conname = 'users_role_check';
    `

    const indexes = await db`
      select indexname
      from pg_indexes
      where indexname = 'idx_students_account_auth0_id';
    `

    const roleDistribution = await db`
      select role, count(*)::int as n
      from users
      group by role
      order by role;
    `

    const linkedStudents = await db`
      select count(*)::int as linked
      from students
      where account_auth0_id is not null;
    `

    return { columns, constraints, indexes, roleDistribution, linkedStudents }
  })

  console.log(JSON.stringify(result, null, 2))

  if (!result) {
    console.error("History store is not configured (DATABASE_URL not set).")
    process.exit(1)
  }

  const cols = result.columns ?? []
  const hasUsersRole = cols.some(
    (c) => c.table_name === "users" && c.column_name === "role",
  )
  const hasStudentsLink = cols.some(
    (c) => c.table_name === "students" && c.column_name === "account_auth0_id",
  )
  const hasCheck = (result.constraints ?? []).length > 0
  const hasIndex = (result.indexes ?? []).length > 0

  if (!hasUsersRole || !hasStudentsLink || !hasCheck || !hasIndex) {
    console.error(
      JSON.stringify({
        type: "migration_verify_failed",
        hasUsersRole,
        hasStudentsLink,
        hasCheck,
        hasIndex,
      }),
    )
    process.exit(1)
  }

  console.log(
    JSON.stringify({
      type: "migration_verify_ok",
      usersRoleColumn: hasUsersRole,
      studentsAccountLinkColumn: hasStudentsLink,
      usersRoleCheck: hasCheck,
      studentsAccountIndex: hasIndex,
      roleDistribution: result.roleDistribution ?? [],
      linkedStudents: result.linkedStudents?.linked ?? 0,
    }),
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(JSON.stringify({ type: "migration_error", error: String(error) }))
  process.exit(1)
})