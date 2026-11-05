function skillWrites(skillIds, requiredSkills) {
  return skillIds.map((skillId) => ({
    isRequired: requiredSkills ? requiredSkills.includes(skillId) : true,
    skill: { connect: { id: skillId } },
  }));
}

function questionWrites(screeningQuestions, jobId) {
  return screeningQuestions.map(({ id, ...question }) => ({
    ...question,
    jobId,
    options: question.options || undefined,
  }));
}

async function createJobAtomic(database, { companyId, jobData, skillIds, requiredSkills, screeningQuestions }) {
  return database.$transaction(async (transaction) => {
    const job = await transaction.job.create({
      data: {
        ...jobData,
        companyId,
        skills: { create: skillWrites(skillIds, requiredSkills) },
      },
      include: { company: true, skills: { include: { skill: true } } },
    });
    if (screeningQuestions.length) {
      await transaction.jobScreeningQuestion.createMany({ data: questionWrites(screeningQuestions, job.id) });
    }
    return job;
  });
}

async function updateJobAtomic(database, { jobId, jobData, skillIds, requiredSkills, screeningQuestions }) {
  return database.$transaction(async (transaction) => {
    const job = await transaction.job.update({
      where: { id: jobId },
      data: {
        ...jobData,
        ...(skillIds ? { skills: { deleteMany: {}, create: skillWrites(skillIds, requiredSkills) } } : {}),
      },
      include: { company: true, skills: { include: { skill: true } } },
    });
    if (screeningQuestions) {
      await transaction.jobScreeningQuestion.deleteMany({ where: { jobId } });
      if (screeningQuestions.length) {
        await transaction.jobScreeningQuestion.createMany({ data: questionWrites(screeningQuestions, jobId) });
      }
    }
    return job;
  });
}

module.exports = { createJobAtomic, updateJobAtomic };
