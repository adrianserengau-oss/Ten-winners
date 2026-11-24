function sandboxDeployment(env = process.env) {
  if (env.PI_SANDBOX !== 'true') return false;
  if (env.VERCEL_ENV || env.VERCEL || env.VERCEL_TARGET_ENV) {
    return ['preview', 'development'].includes(env.VERCEL_ENV) &&
      (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === env.VERCEL_ENV);
  }
  return env.NODE_ENV === 'development';
}

function purchasesEnabled(env = process.env) {
  const sandboxRedis = env.PI_SANDBOX_REDIS_URL?.trim().replace(/\/+$/, '');
  return Boolean(sandboxDeployment(env) && env.PI_SANDBOX_PURCHASES === 'true' &&
    env.PI_SANDBOX_API_KEY?.trim() && sandboxRedis && env.PI_SANDBOX_REDIS_TOKEN?.trim() &&
    [env.KV_REST_API_URL, env.UPSTASH_REDIS_REST_URL].every(
      (url) => url?.trim().replace(/\/+$/, '') !== sandboxRedis
    ));
}

module.exports = { sandboxDeployment, purchasesEnabled };
