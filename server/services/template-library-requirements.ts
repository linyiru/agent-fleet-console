export type TemplateRequirements = {
  envKeys?: string[];
  oauthProviders?: string[];
  capabilities?: {
    codexCli?: boolean;
    payments?: boolean;
    sharedMemory?: boolean;
    telegram?: boolean;
  };
};

export function unique(values: string[] = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

export function missingFromConfig(requirements: TemplateRequirements = {}, config: any = {}) {
  const credentialKeys = new Set((config.credentials || []).map((item: any) => String(item.key || "")));
  const oauthProviders = new Set((config.oauthCredentials || []).map((item: any) => String(item.provider || "")));
  const missing = [];
  for (const key of unique(requirements.envKeys || [])) {
    if (!credentialKeys.has(key)) missing.push({ type: "credential", key, label: `Credential ${key}` });
  }
  for (const provider of unique(requirements.oauthProviders || [])) {
    if (!oauthProviders.has(provider)) missing.push({ type: "oauth", key: provider, label: `${provider} device login` });
  }
  return { ok: missing.length === 0, missing };
}
