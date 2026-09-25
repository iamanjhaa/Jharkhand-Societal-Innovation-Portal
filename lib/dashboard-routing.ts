export type AuthenticatedRole = 'citizen' | 'government' | 'university' | 'industry'
export type DashboardView = 'citizen' | 'government' | 'university' | 'industry'

export function resolveDashboardView(
  role: string | undefined,
  accountType?: string | null,
  universityRole?: string | null,
): DashboardView | null {
  if (role === 'citizen') return 'citizen'
  if (role === 'government') return 'government'
  if (role === 'industry') return 'industry'
  if (role === 'university' && (universityRole === 'innovation_coordinator'
    || ['student', 'faculty', 'researcher'].includes(accountType || '')
    || !accountType)) {
    return 'university'
  }
  return null
}
