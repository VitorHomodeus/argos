// Prevent accidental deployment of the QA build to the public original domain.
export function assertArgosDeployment(hostname, config) {
  if (hostname !== 'argoslab.netlify.app') return true;
  if (config?.deploymentTarget !== 'production') {
    throw new Error('ARGOS: build de homologação bloqueado no domínio oficial.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl || '') ||
      config.supabaseUrl.includes('zdfddnseifqlherqhiyj')) {
    throw new Error('ARGOS: banco definitivo ausente ou ainda é o QA.');
  }
  return true;
}
