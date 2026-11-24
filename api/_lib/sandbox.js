function sandboxDeployment(env = process.env) {
  if (env.PI_SANDBOX !== 'true') return false;
  if (env.VERCEL_ENV || env.VERCEL || env.VERCEL_TARGET_ENV) {
    return ['preview', 'development'].includes(env.VERCEL_ENV) &&
      (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === env.VERCEL_ENV);
  }
  return env.NODE_ENV === 'development';
}

function purchaseBlocker(env = process.env) {
  if (!sandboxDeployment(env)) return 'outside_sandbox';
  if (env.PI_SANDBOX_PURCHASES !== 'true') return 'disabled';
  if (!env.PI_SANDBOX_API_KEY?.trim()) return 'missing_pi_key';
  const sandboxRedis = env.PI_SANDBOX_REDIS_URL?.trim().replace(/\/+$/, '');
  if (!sandboxRedis || !env.PI_SANDBOX_REDIS_TOKEN?.trim()) return 'missing_redis';
  if ([env.KV_REST_API_URL, env.UPSTASH_REDIS_REST_URL].some(
    (url) => url?.trim().replace(/\/+$/, '') === sandboxRedis
  )) return 'shared_redis';
  return null;
}

const purchasesEnabled = (env) => purchaseBlocker(env) === null;

module.exports = { sandboxDeployment, purchasesEnabled, purchaseBlocker };
