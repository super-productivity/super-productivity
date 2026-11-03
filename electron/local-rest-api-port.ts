export const LOCAL_REST_API_PORT_ARG = '--rest-api-port=';
export const LOCAL_REST_API_PORT_ENV = 'SP_LOCAL_REST_API_PORT';

// Below 1024 needs elevated rights on most systems.
const MIN_PORT = 1024;
const MAX_PORT = 65535;

const parsePort = (raw: string | undefined): number | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d{1,5}$/.test(trimmed)) {
    return undefined;
  }
  const port = Number(trimmed);
  return port >= MIN_PORT && port <= MAX_PORT ? port : undefined;
};

/**
 * The port of the local REST API (and the assistant endpoint on the same
 * listener). `--rest-api-port=<n>` wins, then `SP_LOCAL_REST_API_PORT`, then
 * `defaultPort`. Lets two profiles (each with its own `--user-data-dir`) run
 * side by side. An invalid value is skipped, so a typo falls back to the next
 * source instead of leaving the API without a port.
 */
export const resolveLocalRestApiPort = ({
  argv,
  env,
  defaultPort,
}: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  defaultPort: number;
}): number => {
  const fromArg = argv
    .find((arg) => arg.startsWith(LOCAL_REST_API_PORT_ARG))
    ?.slice(LOCAL_REST_API_PORT_ARG.length);
  return parsePort(fromArg) ?? parsePort(env[LOCAL_REST_API_PORT_ENV]) ?? defaultPort;
};
