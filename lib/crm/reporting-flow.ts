// Reporting flows are ordered from the lowest role to the highest. When a role
// is added automatically (for example because someone was assigned work in a
// workbook that does not list their role yet) it is placed using this canonical
// order instead of being appended to the very top, so existing visibility and
// notification rules stay sensible.

const ROLE_RANK: Record<string, number> = {
  telecaller: 10,
  team_member: 20,
  agm: 30,
  hr: 40,
  ceo: 50,
  head_office: 60,
}

const UNKNOWN_RANK = 55

function rank(roleCode: string) {
  return ROLE_RANK[roleCode] ?? UNKNOWN_RANK
}

function unique(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))]
}

/**
 * Merge missing roles into an ordered flow. Existing order is preserved; each
 * new role is inserted before the first role that ranks above it.
 */
export function mergeFlowRoles(existing: string[], additions: string[]): string[] {
  const result = unique(existing)
  for (const roleCode of unique(additions)) {
    if (result.includes(roleCode)) continue
    const targetRank = rank(roleCode)
    let index = result.findIndex((current) => rank(current) > targetRank)
    if (index === -1) index = result.length

    // Head office always stays at the top of the chain when it is present.
    const headOfficeIndex = result.indexOf('head_office')
    if (headOfficeIndex !== -1 && index > headOfficeIndex) index = headOfficeIndex

    result.splice(index, 0, roleCode)
  }
  return result
}
