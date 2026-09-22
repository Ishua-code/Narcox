'use strict';

const { readSession } = require('../../lib/auth');

module.exports = async (req, res) => {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  res.status(200).json({ authenticated: true, email: session.email });
};
