/** Live names take precedence; remembered names are display-only fallbacks. */
export function flowTeamBadges(
  bindings: readonly { readonly flowId: string; readonly teamId: string; readonly teamName?: string }[],
  teams: readonly { readonly id: string; readonly name: string }[],
): Readonly<Record<string, string>> {
  const names = new Map(teams.map((team) => [team.id, team.name]))
  return Object.fromEntries(bindings.map((binding) => [binding.flowId, names.get(binding.teamId) ?? binding.teamName ?? binding.teamId]))
}
