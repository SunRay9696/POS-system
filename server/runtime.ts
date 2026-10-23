/** Keep local development private while allowing Render's proxy to reach HTTP. */
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const onRender = env.RENDER === 'true';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const host = env.HOST || (onRender ? '0.0.0.0' : '127.0.0.1');
  const base = env.PUBLIC_BASE_URL || (onRender ? env.RENDER_EXTERNAL_URL : undefined);
  let publicBaseUrl: string | undefined;
  if (base) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('PUBLIC_BASE_URL must be an HTTP or HTTPS website address.');
    }
    publicBaseUrl = url.origin;
  }
  const secureCookie = env.COOKIE_SECURE === undefined
    ? publicBaseUrl?.startsWith('https://') === true
    : env.COOKIE_SECURE === 'true';

  return { host, port, publicBaseUrl, secureCookie };
}
