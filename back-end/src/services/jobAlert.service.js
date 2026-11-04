function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function skillIds(alert) {
  return Array.isArray(alert.skillIds) ? alert.skillIds.map(Number).filter(Number.isInteger) : [];
}

function matchesAlert(alert, job) {
  const keyword = normalize(alert.keyword);
  const haystack = normalize(`${job.title || ''} ${job.description || ''}`);
  if (keyword && !haystack.includes(keyword)) return false;
  if (alert.location && !normalize(job.location).includes(normalize(alert.location))) return false;
  if (alert.employmentType && job.employmentType !== alert.employmentType) return false;
  if (alert.minSalary !== null && alert.minSalary !== undefined && job.maxSalary !== null && job.maxSalary !== undefined && Number(job.maxSalary) < Number(alert.minSalary)) return false;
  const requiredSkills = skillIds(alert);
  if (requiredSkills.length && !(job.skills || []).some((item) => requiredSkills.includes(Number(item.skillId || item.skill?.id)))) return false;
  return true;
}

function dueSince(alert, now = new Date()) {
  const interval = alert.frequency === 'INSTANT' ? 1 / 1440 : alert.frequency === 'WEEKLY' ? 7 : 1;
  return alert.lastSentAt || new Date(now.getTime() - interval * 24 * 60 * 60 * 1000);
}

function isDue(alert, now = new Date()) {
  const intervalMs = alert.frequency === 'INSTANT'
    ? 60 * 1000
    : (alert.frequency === 'WEEKLY' ? 7 : 1) * 24 * 60 * 60 * 1000;
  return !alert.lastSentAt || now.getTime() - new Date(alert.lastSentAt).getTime() >= intervalMs;
}

module.exports = { matchesAlert, dueSince, isDue };
