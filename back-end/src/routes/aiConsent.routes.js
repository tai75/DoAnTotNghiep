const { z } = require('zod');
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { AI_POLICY_VERSION, AI_SCOPES, grantConsent, listConsents, withdrawConsent } = require('../services/aiConsent.service');

const scopeSchema = z.enum(AI_SCOPES);
const paramsSchema = z.object({ body: z.object({}), params: z.object({ scope: scopeSchema }), query: z.object({}) });

router.get('/consents', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { policyVersion: AI_POLICY_VERSION, provider: 'Google Gemini', items: await listConsents(req.user.id) } });
}));

router.put('/consents/:scope', authenticate, validate(paramsSchema), asyncHandler(async (req, res) => {
  const consent = await grantConsent(req.user.id, req.params.scope);
  res.json({ success: true, data: { scope: consent.scope, policyVersion: consent.policyVersion, grantedAt: consent.grantedAt, active: !consent.withdrawnAt && !consent.withdrawalRequestedAt, withdrawalStatus: 'NONE', version: consent.version } });
}));

router.delete('/consents/:scope', authenticate, validate(paramsSchema), asyncHandler(async (req, res) => {
  const result = await withdrawConsent(req.user.id, req.params.scope);
  res.status(result.status === 'PENDING' ? 202 : 200).json({
    success: true,
    data: {
      scope: req.params.scope, policyVersion: AI_POLICY_VERSION, active: false,
      requestStatus: 'REQUESTED', withdrawalStatus: result.status, blockerCount: result.blockers.length
    }
  });
}));

module.exports = router;
