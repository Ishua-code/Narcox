'use strict';

const { isEmailAllowed, createSessionCookie } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const { email } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  if (!isEmailAllowed(email)) {
    return res.status(403).json({ error: 'this email is not authorized' });
  }

  res.setHeader('Set-Cookie', createSessionCookie(email.trim().toLowerCase()));
  res.status(200).json({ ok: true, email: email.trim().toLowerCase() });
};
