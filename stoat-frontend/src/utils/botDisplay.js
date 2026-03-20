export function isBotUser(userObj) {
  const owner = userObj?.bot?.owner;
  return typeof owner === 'string' && owner.trim().length > 0;
}

export function isVerifiedBotUser(userObj) {
  return !!userObj?.verified_bot;
}
