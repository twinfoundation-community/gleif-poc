import { getEnvConfig } from './config';

/**
 * Check Sally's health/status
 */
export async function checkSallyStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${getEnvConfig().sallyUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
