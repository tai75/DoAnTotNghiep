const numericPathId = (link, segment) => {
  const match = String(link || '').match(new RegExp(`/${segment}/(\\d+)(?:[/?#]|$)`))
  return match?.[1] || null
}

const numericQueryId = (link, key) => {
  const match = String(link || '').match(new RegExp(`[?&]${key}=(\\d+)(?:[&#]|$)`))
  return match?.[1] || null
}

const roleHome = { CANDIDATE: '/jobs', RECRUITER: '/recruiter', ADMIN: '/admin' }

export function resolveNotificationDestination(notification, role) {
  const type = notification?.type
  const link = notification?.link

  if (role === 'CANDIDATE') {
    if (type === 'APPLICATION_STATUS_CHANGED') return '/my-jobs?tab=applied'
    if (type === 'TALENT_INVITATION') {
      const invitationId = numericPathId(link, 'invitations')
      return invitationId ? `/invitations/${invitationId}` : '/invitations'
    }
    if (['JOB_ALERT', 'NEW_COMPANY_JOB'].includes(type)) {
      const jobId = numericPathId(link, 'jobs')
      return jobId ? `/jobs/${jobId}` : '/jobs'
    }
    return roleHome.CANDIDATE
  }

  if (role === 'RECRUITER') {
    if (type === 'TALENT_INVITATION_RESPONSE') {
      const jobId = numericQueryId(link, 'jobId')
      return jobId ? `/recruiter/talent?jobId=${jobId}` : '/recruiter/talent'
    }
    if (['NEW_APPLICATION', 'APPLICATION_STATUS_CHANGED'].includes(type)) {
      const applicationId = numericQueryId(link, 'applicationId') || numericPathId(link, 'applications')
      return applicationId ? `/recruiter?section=applications&applicationId=${applicationId}` : '/recruiter?section=applications'
    }
    if (type === 'JOB_MODERATION') {
      const jobId = numericQueryId(link, 'jobId') || numericPathId(link, 'jobs')
      return jobId ? `/recruiter?section=jobs&jobId=${jobId}` : '/recruiter?section=jobs'
    }
    return roleHome.RECRUITER
  }

  if (role === 'ADMIN') {
    if (['JOB_MODERATION', 'JOB_PENDING', 'NEW_JOB_PENDING'].includes(type)) return '/admin?section=jobs'
    if (['REVIEW_PENDING', 'NEW_REVIEW_PENDING'].includes(type)) return '/admin?section=reviews'
    return roleHome.ADMIN
  }

  return '/jobs'
}

export const supportedNotificationTypes = ['APPLICATION_STATUS_CHANGED', 'NEW_APPLICATION', 'JOB_MODERATION', 'NEW_COMPANY_JOB', 'JOB_ALERT', 'TALENT_INVITATION', 'TALENT_INVITATION_RESPONSE', 'SYSTEM']
