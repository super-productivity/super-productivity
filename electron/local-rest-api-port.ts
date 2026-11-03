export const LOCAL_REST_API_PORT_FLAG = '--rest-api-port';
export const LOCAL_REST_API_PORT_ARG = `${LOCAL_REST_API_PORT_FLAG}=`;
export const LOCAL_REST_API_PORT_ENV = 'SP_LOCAL_REST_API_PORT';

// Below 1024 needs elevated rights on most systems.
const MIN_PORT = 1024;
const MAX_PORT = 65535;

const parsePort = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) {
    return undefined;
  }
  const port = Number(trimmed);
  return port >= MIN_PORT && port <= MAX_PORT ? port : undefined;
};

export interface LocalRestApiPortResult {
  port: number;
  /** Why a given value was not used, for the caller to log. */
  warnings: string[];
}

/**
 * The port of the local REST API (and the assistant endpoint on the same
 * listener). `--rest-api-port=<n>` wins, then `SP_LOCAL_REST_API_PORT`, then
 * `defaultPort`. Lets two profiles (each with its own `--user-data-dir`) run
 * side by side. An invalid value is skipped with a warning, so a typo falls
 * back to the next source instead of leaving the API without a port.
 */
export const resolveLocalRestApiPort = ({
  argv,
  env,
  defaultPort,
}: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  defaultPort: number;
}): LocalRestApiPortResult => {
  const warnings: string[] = [];
  const use = (raw: string, label: string): number | undefined => {
    const port = parsePort(raw);
    if (port === undefined) {
      warnings.push(
        `Ignoring ${label}=${JSON.stringify(raw)}: not a port from ${MIN_PORT} to ${MAX_PORT}`,
      );
    }
    return port;
  };

  if (argv.includes(LOCAL_REST_API_PORT_FLAG)) {
    warnings.push(
      `Ignoring ${LOCAL_REST_API_PORT_FLAG} without a value: use ${LOCAL_REST_API_PORT_ARG}<port>`,
    );
  }
  const argValue = argv
    .find((arg) => arg.startsWith(LOCAL_REST_API_PORT_ARG))
    ?.slice(LOCAL_REST_API_PORT_ARG.length);
  const fromArg =
    argValue === undefined ? undefined : use(argValue, LOCAL_REST_API_PORT_FLAG);
  if (fromArg !== undefined) {
    return { port: fromArg, warnings };
  }

  // An empty variable reads as unset, as it does for most tools.
  const envValue = env[LOCAL_REST_API_PORT_ENV];
  const fromEnv = envValue?.trim() ? use(envValue, LOCAL_REST_API_PORT_ENV) : undefined;
  return { port: fromEnv ?? defaultPort, warnings };
};
