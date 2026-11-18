export function mergeRecruiterApplication(current, update) {
  if (!update?.candidate) return { ...current, ...update }

  const candidate = {
    ...current.candidate,
    ...update.candidate,
    user: { ...current.candidate?.user, ...update.candidate.user },
    skills: Array.isArray(update.candidate.skills)
      ? update.candidate.skills
      : (Array.isArray(current.candidate?.skills) ? current.candidate.skills : [])
  }

  return { ...current, ...update, candidate }
}
