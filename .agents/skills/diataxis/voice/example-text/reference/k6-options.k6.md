---
type: reference
source: https://grafana.com/docs/k6/latest/using-k6/k6-options/reference/
title: Options reference
domain: k6
---

# Options reference

Options define test-run behavior. Most options can be passed in multiple places. If an option is defined in multiple places, k6 chooses the value from the highest [order of precedence](/docs/k6/latest/using-k6/k6-options/how-to/#order-of-precedence).

## Quick reference of options

Each option has its own detailed reference in a separate section.

Expand table

Option| Description
---|---
Address| Address of the REST API server
Batch| Max number of simultaneous connections of a `http.batch()` call
Batch per host| Max number of simultaneous connections of a `http.batch()` call for a host
Blacklist IP| Blacklist IP ranges from being called
Block hostnames| Block any requests to specific hostnames
Compatibility mode| Support running scripts with different ECMAScript modes
Config| Specify the config file in JSON format to read the options values
Console output| Redirects logs logged by `console` methods to the provided output file
Discard response bodies| Specify whether response bodies should be discarded
DNS| Configure DNS resolution behavior
Dependency manifest| Specify a dependency manifest file to validate dependencies against before running the test
Duration| A string specifying the total duration of the test run; together with the vus option, it’s a shortcut for a single [scenario](/docs/k6/latest/using-k6/scenarios/) with a [constant VUs executor](/docs/k6/latest/using-k6/scenarios/executors/constant-vus/)
Execution segment| Limit execution to a segment of the total test
Exit on running| Exits when test reaches the running status
Cloud options| An object used to set configuration options for cloud parameters.
Features| Enable [feature flags](/docs/k6/latest/using-k6/feature-flags/) to opt in to new, not-yet-stable behavior
Handle summary timeout| Specify how long the [handleSummary()](/docs/k6/latest/results-output/end-of-test/custom-summary/) function is allowed to run before it’s terminated
Hosts| An object with overrides to DNS resolution
HTTP debug| Log all HTTP requests and responses
Include system Env vars| Pass the real system environment variables to the runtime
Insecure skip TLS verify| A boolean specifying whether k6 should ignore TLS verifications for connections established from code
Iterations| A number specifying a fixed number of iterations to execute of the script; together with the vus option, it’s a shortcut for a single [scenario](/docs/k6/latest/using-k6/scenarios/) with a [shared iterations executor](/docs/k6/latest/using-k6/scenarios/executors/shared-iterations/)
Linger| A boolean specifying whether k6 should linger around after test run completion
Local IPs| A list of local IPs, IP ranges, and CIDRs from which VUs will make requests
Log output| Configuration about where logs from k6 should be send
Log nanosecond timestamps| A boolean specifying whether log timestamps use nanosecond instead of second precision
LogFormat| Specify the format of the log output
Max redirects| The maximum number of HTTP redirects that k6 will follow
Minimum iteration duration| Specify the minimum duration for every single execution
No color| A boolean specifying whether colored output is disabled
No connection reuse| A boolean specifying whether k6 should disable keep-alive connections
No cookies reset| This disables resetting the cookie jar after each VU iteration
No setup| A boolean specifying whether `setup()` function should be run
No teardown| A boolean specifying whether `teardown()` function should be run
No thresholds| Disables threshold execution
No usage report| A boolean specifying whether k6 should send a usage report
No VU connection reuse| A boolean specifying whether k6 should reuse TCP connections
Once| Run one iteration with one VU while preserving a single scenario’s function and settings.
Paused| A boolean specifying whether the test should start in a paused state
Profiling Enabled| Enables profiling endpoints
Quiet| A boolean specifying whether to show the progress update in the console or not
Results output| Specify the results output
RPS| The maximum number of requests to make per second globally (discouraged, use [arrival-rate executors](/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/) instead)
Scenario selection| Select configured scenarios to run without changing their settings.
Scenarios| Define advanced execution scenarios
Secret Sources| Specify source of secrets to be used within k6.
Setup timeout| Specify how long the `setup()` function is allow to run before it’s terminated
Show logs| A boolean specifying whether the cloud logs are printed out to the terminal
Stages| A list of objects that specify the target number of VUs to ramp up or down; shortcut option for a single [scenario](/docs/k6/latest/using-k6/scenarios/) with a [ramping VUs executor](/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/)
Supply environment variable| Add/override environment variable with `VAR=value`
System tags| Specify which System Tags will be in the collected metrics
Summary export| Output the [end-of-test summary](/docs/k6/latest/results-output/end-of-test/) report to a JSON file (discouraged, use [handleSummary()](/docs/k6/latest/results-output/end-of-test/custom-summary/) instead)
Summary mode| Define how detailed the end-of-test summary should be
Summary trend stats| Define stats for trend metrics in the [end-of-test summary](/docs/k6/latest/results-output/end-of-test/)
Summary time unit| Time unit to be used for _all_ time values in the [end-of-test summary](/docs/k6/latest/results-output/end-of-test/)
Tags| Specify tags that should be set test-wide across all metrics
Teardown timeout| Specify how long the teardown() function is allowed to run before it’s terminated
Thresholds| Configure under what conditions a test is successful or not
Throw| A boolean specifying whether to throw errors on failed HTTP requests
TLS AIA fetch| A boolean that lets k6 fetch missing intermediate CA certificates via the Authority Information Access (AIA) extension
TLS auth| A list of TLS client certificate configuration objects
TLS cipher suites| A list of cipher suites allowed to be used by in SSL/TLS interactions with a server
TLS version| String or object representing the only SSL/TLS version allowed
Traces output| Configuration about where traces from k6 should be sent
User agent| A string specifying the User-Agent header when sending HTTP requests
Verbose| A boolean specifying whether verbose logging is enabled
VUs| A number specifying the number of VUs to run concurrently

The following sections detail all available options that you can be specify within a script.

It also documents the equivalent command line flag, environment variables or option when executing `k6 run ...` and `k6 cloud run ...`, which you can use to override options specified in the code.

## Address

Address of the API server. When set, k6 starts an HTTP server with a REST API that can be used to control some of the parameters of the test execution.

Starting in k6 v2.0.0, the REST API server is **off by default**. To enable it, pass `--address` (or set `K6_ADDRESS`) with the address you want it to listen on. Read more on [k6 REST API](/docs/k6/latest/reference/k6-rest-api/).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_ADDRESS`| `--address`, `-a`| N/A|  _(unset; server disabled)_

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --address "localhost:6565" script.js

## Batch

The maximum number of simultaneous/parallel connections in total that an [`http.batch()`](/docs/k6/latest/javascript-api/k6-http/batch/) call in a VU can make. If you have a `batch()` call that you’ve given 20 URLs to and `--batch` is set to 15, then the VU will make 15 requests right away in parallel and queue the rest, executing them as soon as a previous request is done and a slot opens. Available in both the `k6 run` and the `k6 cloud run` commands

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_BATCH`| `--batch`| `batch`| `20`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      batch: 15,
    };

## Batch per host

The maximum number of simultaneous/parallel connections for the same hostname that an [`http.batch()`](/docs/k6/latest/javascript-api/k6-http/batch/) call in a VU can make. If you have a `batch()` call that you’ve given 20 URLs to the _same_ hostname and `--batch-per-host` is set to 5, then the VU will make 5 requests right away in parallel and queue the rest, executing them as soon as a previous request is done and a slot opens. This will not run more request in parallel then the value of `batch`. Available in both the `k6 run` and the `k6 cloud run` commands

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_BATCH_PER_HOST`| `--batch-per-host`| `batchPerHost`| `6`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      batchPerHost: 5,
    };

## Blacklist IP

Blacklist IP ranges from being called. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_BLACKLIST_IPS`| `--blacklist-ip`| `blacklistIPs`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      blacklistIPs: ['10.0.0.0/8'],
    };

## Block hostnames

Blocks hostnames based on a list of glob match strings. The pattern matching string can have a single `*` at the beginning such as `*.example.com` that will match anything before that such as `test.example.com` and `test.test.example.com`. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_BLOCK_HOSTNAMES`| `--block-hostnames`| `blockHostnames`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      blockHostnames: ['test.k6.io', '*.example.com'],
    };

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --block-hostnames="test.k6.io,*.example.com" script.js

## Compatibility mode

Support running scripts with different ECMAScript compatibility modes.

Read about the different modes on the [JavaScript Compatibility Mode documentation](/docs/k6/latest/using-k6/javascript-compatibility-mode/).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_COMPATIBILITY_MODE`| `--compatibility-mode`| N/A| `"extended"`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --compatibility-mode=base script.js

## Config

Specify the config file in JSON format. If the config file is not specified, k6 looks for `config.json` in the `k6/` directory inside the regular directory for configuration files on the operating system. Default config locations on different operating systems are as follows:

Expand table

OS| Default Config Path
---|---
Unix-based| `${HOME}/.config/k6/config.json`
macOS| `${HOME}/Library/Application Support/k6/config.json`
Windows| `%AppData%/k6/config.json`

Available in `k6 run` and `k6 cloud run` commands:

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--config <path>`, `-c <path>`| N/A| `null`

> Note
>
> When running tests in k6 Cloud and using a non-default config.json file, specify the cloud token inside your config file to authenticate.

## Console output

Redirects logs logged by `console` methods to the provided output file. Available in `k6 cloud run` and `k6 run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_CONSOLE_OUTPUT`| `--console-output`| N/A| `null`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --console-output "loadtest.log" script.js

## Discard response bodies

Specify if response bodies should be discarded by changing the default value of [responseType](/docs/k6/latest/javascript-api/k6-http/params/) to `none` for all HTTP requests. Highly recommended to be set to `true` and then only for the requests where the response body is needed for scripting to set [responseType](/docs/k6/latest/javascript-api/k6-http/params/) to `text` or `binary`. Lessens the amount of memory required and the amount of GC - reducing the load on the testing machine, and probably producing more reliable test results.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_DISCARD_RESPONSE_BODIES`| `--discard-response-bodies`| `discardResponseBodies`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      discardResponseBodies: true,
    };

## DNS

This is a composite option that provides control of DNS resolution behavior with configuration for cache expiration (TTL), IP selection strategy and IP version preference. The TTL field in the DNS record is currently not read by k6, so the `ttl` option allows manual control over this behavior, albeit as a fixed value for the duration of the test run.

Note that DNS resolution is done only on new HTTP connections, and by default k6 will try to reuse connections if HTTP keep-alive is supported. To force a certain DNS behavior consider enabling the `noConnectionReuse` option in your tests.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_DNS`| `--dns`| `dns`| `ttl=5m,select=random,policy=preferIPv4`

Possible `ttl` values are:

  * `0`: no caching at all - each request will trigger a new DNS lookup.
  * `inf`: cache any resolved IPs for the duration of the test run.
  * any time duration like `60s`, `5m30s`, `10m`, `2h`, etc.; if no unit is specified (e.g. `ttl=3000`), k6 assumes milliseconds.


Possible `select` values are:

  * `first`: always pick the first resolved IP.
  * `random`: pick a random IP for every new connection.
  * `roundRobin`: iterate sequentially over the resolved IPs.


Possible `policy` values are:

  * `preferIPv4`: use IPv4 addresses if available, otherwise fall back to IPv6.
  * `preferIPv6`: use IPv6 addresses if available, otherwise fall back to IPv4.
  * `onlyIPv4`: only use IPv4 addresses, ignore any IPv6 ones.
  * `onlyIPv6`: only use IPv6 addresses, ignore any IPv4 ones.
  * `any`: no preference, use all addresses.


Here are some configuration examples:

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    K6_DNS="ttl=5m,select=random,policy=preferIPv4" k6 cloud run script.js

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      dns: {
        ttl: '1m',
        select: 'roundRobin',
        policy: 'any',
      },
    };

## Dependency manifest

Specify a dependency manifest as JSON to set default constraints for k6 extensions and k6 itself used in your test script. When you provide a dependency manifest, k6 uses it to set default constraints for k6 extensions that are used in the script but don’t have concrete constraints specified.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_DEPENDENCY_MANIFEST`| N/A| N/A| `null`

The `K6_DEPENDENCY_MANIFEST` environment variable contains the JSON manifest content itself as a simple key-value object, not a path to a file.

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    K6_DEPENDENCY_MANIFEST='{"k6":"v1.6.0","k6/x/faker":"v0.4.4"}' k6 run script.js

The dependency manifest is a JSON object with key-value pairs mapping k6 extension names (or `k6` itself) to version constraints. For example, `{"k6":"v1.6.0","k6/x/faker":"v0.4.4"}`. For k6 extensions that don’t have explicit version constraints in your script, the manifest provides default constraints to ensure consistent resolution.

For more information about generating and using dependency manifests, refer to the [`k6 deps` command documentation](/docs/k6/latest/using-k6/k6-deps-command/).

## Duration

A string specifying the total duration a test run should be run for. During this time each VU will execute the script in a loop. Available in `k6 run` and `k6 cloud run` commands.

Together with the `vus` option, `duration` is a shortcut for a single [scenario](/docs/k6/latest/using-k6/scenarios/) with a [constant VUs executor](/docs/k6/latest/using-k6/scenarios/executors/constant-vus/).

> Note
>
> For a smoke or functional test that runs once, use `--once`. It runs one iteration with one VU and preserves a single scenario’s function and settings, including browser options. `--duration` sets a time-based load and can replace the script’s scenario configuration.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_DURATION`| `--duration`, `-d`| `duration`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      vus: 100,
      duration: '3m',
    };

## Cloud options

An object used to set configuration options for Grafana Cloud k6. For more information about available parameters, refer to [Cloud options](/docs/grafana-cloud/testing/k6/author-run/cloud-scripting-extras/cloud-options/).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `cloud`| `null`

This is an example of how to specify the test name (test runs/executions with the same name will be logically grouped for trending and comparison) when streaming results to [Grafana Cloud k6](/docs/grafana-cloud/testing/k6/).

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      cloud: {
        name: 'My test name',
      },
    };

## Execution segment

These options specify how to partition the test run and which segment to run. If defined, k6 will scale the number of VUs and iterations to be run for that segment, which is useful in distributed execution. Available in `k6 run` and `k6 cloud run` commands.

> Note
>
> To run the script once with one VU, use `--once` instead of dividing the test into execution segments. `--once` preserves a single scenario’s behavior and browser settings, and cannot be combined with `--execution-segment` or `--execution-segment-sequence`.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--execution-segment`| `executionSegment`| `"0:1"`
N/A| `--execution-segment-sequence`| `executionSegmentSequence`| `"0,1"`

For example, to run 25% of a test, you would specify `--execution-segment '25%'`, which would be equivalent to `--execution-segment '0:1/4'`, i.e. run the first 1/4 of the test. To ensure that each instance executes a specific segment, also specify the full segment sequence, e.g. `--execution-segment-sequence '0,1/4,1/2,1'`. This way one instance could run with `--execution-segment '0:1/4'`, another with `--execution-segment '1/4:1/2'`, etc. and there would be no overlap between them.

## Exit on running

A boolean, specifying whether the script should exit once the test status reaches `running`. When running scripts with `k6 cloud run` by default scripts will run until the test reaches a finalized status. This could be problematic in certain environments (think of Continuous Integration and Delivery pipelines), since you’d need to wait until the test ends up in a finalized state.

With this option, you can exit early and let the script run in the background. Available in `k6 cloud run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_EXIT_ON_RUNNING`| `--exit-on-running`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 cloud run --exit-on-running script.js

## Features

Enable [feature flags](/docs/k6/latest/using-k6/feature-flags/) to opt in to new, not-yet-stable behavior. Available in the `k6 run` and `k6 cloud run` commands. Unlike most options on this page, feature flags can’t be set in the script’s `options` object: use the command-line flag, the environment variable, or the `features` key in the [JSON configuration file](/docs/k6/latest/using-k6/k6-options/how-to/#set-options-with-the---config-flag).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_FEATURES`| `--features`| `features`| `null`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --features native-histograms script.js

## Handle summary timeout

Specify how long the [handleSummary()](/docs/k6/latest/results-output/end-of-test/custom-summary/) function is allowed to run before it’s terminated. If defined, the value must be positive.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_HANDLE_SUMMARY_TIMEOUT`| N/A| `handleSummaryTimeout`| `"120s"`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      handleSummaryTimeout: '30s',
    };

## Hosts

An object with overrides to DNS resolution, similar to what you can do with `/etc/hosts` on Linux/Unix or `C:\Windows\System32\drivers\etc\hosts` on Windows. For instance, you could set up an override which routes all requests for `test.k6.io` to `1.2.3.4`.

k6 also supports ways to narrow or widen the scope of your redirects:

  * You can redirect only from or to certain ports.
  * Starting from v0.42.0, you can use an asterisk (`*`) as a wild card at the start of the host name to avoid repetition. For example, `*.k6.io` would apply the override for all subdomains of `k6.io`.


> Note
>
> This does not modify the actual HTTP `Host` header, but rather where it will be routed.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `hosts`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      hosts: {
        'test.k6.io': '1.2.3.4',
        'test.k6.io:443': '1.2.3.4:8443',
        '*.grafana.com': '1.2.3.4',
      },
    };

The preceding code will redirect requests made to `test.k6.io` to `1.2.3.4`, keeping the same port. If the request is done to port `443`, it will redirect it to port `8443` instead. It will also redirect requests to any subdomain of `grafana.com` to `1.2.3.4`.

## HTTP debug

Log all HTTP requests and responses. Excludes body by default, to include body use `--http-debug=full`. Available in `k6 run` and `k6 cloud run` commands.

Read more [here](/docs/k6/latest/using-k6/http-debugging/).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_HTTP_DEBUG`| `--http-debug`,
`--http-debug=full`| `httpDebug`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      httpDebug: 'full',
    };

## Include system env vars

Pass the real system [environment variables](/docs/k6/latest/using-k6/environment-variables/) to the runtime. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--include-system-env-vars`| N/A| `true` for `k6 run`, but `false` for all other commands to prevent inadvertent sensitive data leaks.

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --include-system-env-vars ~/script.js

## Insecure skip TLS verify

A boolean, true or false. When this option is enabled (set to true), all of the verifications that would otherwise be done to establish trust in a server provided TLS certificate will be ignored. This only applies to connections created from code, such as HTTP requests. Available in `k6 run` and `k6 cloud run` commands

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_INSECURE_SKIP_TLS_VERIFY`| `--insecure-skip-tls-verify`| `insecureSkipTLSVerify`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      insecureSkipTLSVerify: true,
    };

## Iterations

An integer value, specifying the total number of iterations of the `default` function to execute in the test run, as opposed to specifying a duration of time during which the script would run in a loop. Available both in the `k6 run` and `k6 cloud run` commands.

Together with the `vus` option, `iterations` is a shortcut for a single [scenario](/docs/k6/latest/using-k6/scenarios/) with a [shared iterations executor](/docs/k6/latest/using-k6/scenarios/executors/shared-iterations/).

By default, the maximum duration of a `shared-iterations` scenario is 10 minutes. You can adjust that time via the `maxDuration` option of the scenario, or by also specifying the `duration` global shortcut option.

**Note that iterations aren’t fairly distributed with this option, and a VU that executes faster will complete more iterations than others.** Each VU will try to complete as many iterations as possible, [“stealing”](https://en.wikipedia.org/wiki/Work_stealing) them from the total number of iterations for the test. So, depending on iteration times, some VUs may complete more iterations than others. If you want guarantees that every VU will complete a specific, fixed number of iterations, [use the per-VU iterations executor](/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/).

> Note
>
> To run an existing script once, use `--once` instead of `--vus 1 --iterations 1`. It preserves a single scenario’s function, environment variables, tags, and browser options. The shortcut flags can replace the script’s scenarios with a `default` scenario and lose those settings.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_ITERATIONS`| `--iterations`, `-i`| `iterations`| `1`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      vus: 5,
      iterations: 10,
    };

Or, to run 10 VUs 10 times each:

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      vus: 10,
      iterations: 100,
    };

## Linger

A boolean, true or false, specifying whether the k6 process should linger around after test run completion. Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_LINGER`| `--linger`, `-l`| `linger`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      linger: true,
    };

## Local IPs

A list of IPs, IP ranges and CIDRs from which VUs will make requests. The IPs will be sequentially given out to VUs. This option doesn’t change anything on the OS level so the IPs need to be already configured on the OS level for k6 to use them. Also IPv4 CIDRs with more than 2 IPs don’t include the first and last IP as they are reserved for referring to the network itself and the broadcast address respectively.

This option can be used for splitting the network traffic from k6 between multiple network cards, thus potentially increasing the available network throughput. For example, if you have 2 NICs, you can run k6 with `--local-ips="<IP-from-first-NIC>,<IP-from-second-NIC>"` to balance the traffic equally between them - half of the VUs will use the first IP and the other half will use the second. This can scale to any number of NICs, and you can repeat some local IPs to give them more traffic. For example, `--local-ips="<IP1>,<IP2>,<IP3>,<IP3>"` will split VUs between 3 different source IPs in a 25%:25%:50% ratio.

Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_LOCAL_IPS`| `--local-ips`| N/A| N/A

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --local-ips=192.168.20.12-192.168.20.15,192.168.10.0/27 script.js

## Log output

This option specifies where to send logs to and another configuration connected to it. Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_LOG_OUTPUT`| `--log-output`| N/A| `stderr`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --log-output=stdout script.js

Possible values are:

  * none - disable
  * stdout - send to the standard output
  * stderr - send to the standard error output (this is the default)
  * loki - send logs to a loki server
  * file - write logs to a file


### Loki

Use the `log-output` option to configure [Loki](/oss/loki/) as follows. For additional instructions and a step-by-step guide, check out the [Loki tutorial](https://k6.io/blog/using-loki-to-store-and-query-k6-logs/).

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --log-output=loki=http://127.0.0.1:3100/loki/api/v1/push,label.something=else,label.foo=bar,limit=32,level=info,pushPeriod=5m32s,msgMaxSize=1231 script.js

Where all but the url in the beginning are not required. The possible keys with their meanings and default values:

Expand table

key| description| default value
---|---|---
`nothing`| the endpoint to which to send logs| `http://127.0.0.1:3100/loki/api/v1/push`
allowedLabels| if set k6 will send only the provided labels as such and all others will be appended to the message in the form `key=value`. The value of the option is in the form `[label1,label2]`| N/A
label.`labelName`| adds an additional label with the provided key and value to each message| N/A
header.`headerName`| adds an additional HTTP header with the provided header name and value to each HTTP request made to Loki| N/A
limit| the limit of message per pushPeriod, an additional log is send when the limit is reached, logging how many logs were dropped| 100
level| the minimal level of a message so it’s send to loki| all
pushPeriod| at what period to send log lines| 1s
profile| whether to print some info about performance of the sending to loki| false
msgMaxSize| how many symbols can there be at most in a message. Messages bigger will miss the middle of the message with an additional few characters explaining how many characters were dropped.| 1048576

### File

The file can be configured as below, where an explicit file path is required:

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --log-output=file=./k6.log script.js

A valid file path is the unique mandatory field, the other optional fields listed below:

Expand table

key| description| default value
---|---|---
level| the minimal level of a message to write out of (in ascending order): trace, debug, info, warning, error, fatal, panic| trace

## Log nanosecond timestamps

A boolean specifying whether log timestamps use nanosecond precision instead of the default second precision. This is a global flag, available on every k6 subcommand.

This only affects log output that includes an actual timestamp: JSON log output, and the default text format when combined with No color. It has no effect on colored terminal output, which shows elapsed time instead of a timestamp, and no effect on the `raw` log format, which omits the timestamp entirely.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_LOG_NS_TIMESTAMPS`| `--log-ns-timestamps`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --log-format=json --log-ns-timestamps script.js

## LogFormat

A value specifying the log format. By default, k6 includes extra debug information like date and log level. The other options available are:

  * `json`: print all the debug information in JSON format.

  * `raw`: print only the log message.


Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_LOG_FORMAT`| `--log-format`, `-f`| N/A|

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --log-format raw test.js

## Max redirects

The maximum number of HTTP redirects that k6 will follow before giving up on a request and erroring out. Available in both the `k6 run` and the `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_MAX_REDIRECTS`| `--max-redirects`| `maxRedirects`| `10`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      maxRedirects: 10,
    };

## Minimum iteration duration

Specifies the minimum duration of every single execution (i.e. iteration) of the `default` function. Any iterations that are shorter than this value will cause that VU to sleep for the remainder of the time until the specified minimum duration is reached.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_MIN_ITERATION_DURATION`| `--min-iteration-duration`| `minIterationDuration`| `0` (disabled)

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      minIterationDuration: '10s',
    };

## No color

A boolean specifying whether colored output is disabled. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--no-color`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --no-color script.js

Colored terminal output shows elapsed time instead of a timestamp. Disabling colors switches the default text log format to print an actual timestamp.

## No connection reuse

A boolean, true or false, specifying whether k6 should disable keep-alive connections. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_NO_CONNECTION_REUSE`| `--no-connection-reuse`| `noConnectionReuse`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      noConnectionReuse: true,
    };

## No cookies reset

This disables the default behavior of resetting the cookie jar after each VU iteration. If it’s enabled, saved cookies will be persisted across VU iterations.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_NO_COOKIES_RESET`| N/A| `noCookiesReset`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      noCookiesReset: true,
    };

## No setup

A boolean specifying whether `setup()` function should be run. Available in `k6 cloud run` and `k6 run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_NO_SETUP`| `--no-setup`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --no-setup script.js

## No teardown

A boolean specifying whether `teardown()` function should be run. Available in `k6 cloud run` and `k6 run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_NO_TEARDOWN`| `--no-teardown`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --no-teardown script.js

## No thresholds

Disables threshold execution. Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_NO_THRESHOLDS`| `--no-thresholds`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --no-thresholds ~/script.js

## No usage report

A boolean, true or false. By default, k6 sends a usage report each time it is run, so that we can track how often people use it. If this option is set to true, no usage report will be made. To learn more, have a look at the [Usage reports](/docs/k6/latest/set-up/usage-collection/) documentation. Available in `k6 run` commands.

Expand table

Env| CLI| Config file| Default
---|---|---|---
`K6_NO_USAGE_REPORT`| `--no-usage-report`| `noUsageReport`*| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --no-usage-report ~/script.js

* Note that this option is not supported in the exported script options, but can be specified in a configuration file.

## No VU connection reuse

A boolean, true or false, specifying whether k6 should reuse TCP connections between iterations of a VU. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_NO_VU_CONNECTION_REUSE`| `--no-vu-connection-reuse`| `noVUConnectionReuse`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      noVUConnectionReuse: true,
    };

## Once

Use `--once` to run a script with one VU and one iteration for a smoke, end-to-end, or functional test. This is the supported single-run mode for scripts with no scenarios or one scenario, or for scenarios you explicitly select. You can reuse an existing load test, including a browser test, without editing its scenario configuration.

Use `--once` instead of `--vus 1 --iterations 1` when you want to preserve the scenario’s function, environment variables, tags, and browser settings. Those shortcut flags can replace the scenario configuration and remove settings the script needs to run.

Available in `k6 run`, `k6 cloud run`, and `k6 archive` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--once`| N/A| `false`

sh ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --once script.js

If the script defines one scenario, k6 keeps its name, `exec`, `env`, `tags`, and scenario `options`, including browser settings. The scenario uses the `shared-iterations` executor with one VU and one iteration. Its original executor settings and timing are replaced with the executor defaults: `startTime: '0s'`, `maxDuration: '10m'`, and `gracefulStop: '30s'`.

If the script defines no scenarios, k6 runs its `default` function once. A scenario without `exec` also runs `default`, retaining its settings. The required function must exist. For scripts with more than one scenario, use [`--scenario`](/docs/k6/latest/using-k6/scenarios/#run-selected-scenarios) to choose which ones to run; each selected scenario runs once with one VU. Bare `--once` still returns an error for multiple scenarios. The `setup()` and `teardown()` functions run normally.

You cannot combine `--once` with `--vus`, `--duration`, `--iterations`, `--stage`, `--execution-segment`, or `--execution-segment-sequence`. When these load settings come from the script, a configuration file, or environment variables, k6 overrides them and logs a warning.

For example, save this script as `script.js`:

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    import { check } from 'k6';
    import http from 'k6/http';

    export const options = {
      scenarios: {
        checkout: {
          executor: 'constant-vus',
          vus: 10,
          duration: '30s',
          exec: 'checkout',
          env: { BASE_URL: 'https://quickpizza.grafana.com' },
          tags: { team: 'checkout' },
        },
      },
    };

    export function checkout() {
      const response = http.get(__ENV.BASE_URL);
      check(response, { 'status is 200': (r) => r.status === 200 });
    }

Running `k6 run --once script.js` calls `checkout` once using the scenario’s base URL.

## Paused

A boolean, true or false, specifying whether the test should start in a paused state. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_PAUSED`| `--paused`, `-p`| `paused`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      paused: true,
    };

## Profiling Enabled

Enables profiling endpoints under the [k6 REST API address to help debug and profile k6 itself:

  * [pprof](https://pkg.go.dev/net/http/pprof) profiling endpoints for CPU and memory profiling
  * Prometheus [/metrics](https://prometheus.io/docs/guides/go-application/#how-go-exposition-works) endpoint for exporting Go runtime metrics


The k6 REST API must be enabled for these endpoints to be available. Starting in k6 v2.0.0, the REST API is off by default — pass `--address` (or set `K6_ADDRESS`) when starting k6.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_PROFILING_ENABLED`| `--profiling-enabled`| N/A| `http://localhost:6565/debug/pprof/`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --profiling-enabled script.js

## Quiet

A boolean, true or false, that disables the progress update bar on the console output. Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--quiet`, `-q`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run script.js -d 20s --quiet

## Results output

Specify the results output. For information on all available outputs and how to configure them, refer to [Results output](/docs/k6/latest/results-output/).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_OUT`| `--out`, `-o`| N/A| `null`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --out influxdb=http://localhost:8086/k6 script.js

## RPS

The maximum number of requests to make per second, in total across all VUs. Available in `k6 run` and `k6 cloud run` commands.

> Caution
>
> **This option is discouraged.**
>
>  The `--rps` option has caveats and is difficult to use correctly.
>
> For example, in the cloud or distributed execution, this option affects every k6 instance independently. That is, it is not sharded like VUs are.
>
> We strongly recommend the [arrival-rate executors](/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/) to simulate constant RPS instead of this option.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_RPS`| `--rps`| `rps`| `0` (unlimited)

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      rps: 500,
    };

> ### Considerations when running in the cloud
>
> The option is set per load generator which means that the value you set in the options object of your test script will be multiplied by the number of load generators your test run is using. At the moment we are hosting 300 VUs per load generator instance. In practice that means that if you set the option for 100 rps, and run a test with 1000 VUs, you will spin up 4 load gen instances and effective rps limit of your test run will be 400

## Scenario selection

Select one or more configured scenarios by name with `--scenario`, using commas to separate multiple names. Available in `k6 run`, `k6 cloud run`, and `k6 archive`.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--scenario`| N/A| All configured scenarios

Selection keeps each selected scenario’s settings and skips thresholds tied to excluded scenarios. Refer to [Run selected scenarios](/docs/k6/latest/using-k6/scenarios/#run-selected-scenarios) for examples, load-option restrictions, threshold behavior, and combining selection with `--once`.

## Scenarios

Define one or more execution patterns, with various VU and iteration scheduling settings, running different exported functions (besides `default`!), using different environment variables, tags, and more.

See the [Scenarios](/docs/k6/latest/using-k6/scenarios/) article for details and more examples.

Available in `k6 run` and `k6 cloud run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `scenarios`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      scenarios: {
        my_api_scenario: {
          // arbitrary scenario name
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '5s', target: 100 },
            { duration: '5s', target: 0 },
          ],
          gracefulRampDown: '10s',
          env: { MYVAR: 'example' },
          tags: { my_tag: 'example' },
        },
      },
    };

## Secret source

Specify [source of secrets](/docs/k6/latest/using-k6/secret-sources/) to be used within k6 script.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--secret-source`| N/A| N/A

Multiple secret sources can be provided and if `name=<value>` is provided the secret source will have the given name.

Additional `default` can be added to set a single default secret source. If only one is provided it will be the default by default, when multiple are provided it is required to be configured.

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    $ k6 cloud run --secret-source=mock=name=something,key=value,key2=value2 --secret-source=mock,default,key=value3 script.js

The above will define two mock secret source, one of them has a name “something”, while the other one is the default.

## Setup timeout

Specify how long the `setup()` function can run before it’s terminated and the test fails. If defined, the value must be positive.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_SETUP_TIMEOUT`| N/A| `setupTimeout`| `"60s"`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      setupTimeout: '30s',
    };

> Note
>
> In Grafana Cloud k6, the maximum allowed value for `setupTimeout` is _10 minutes_ (`"600s"` or `"10m"`). If `setup()` doesn’t complete within this time, the test fails before any VUs start.

## Show logs

A boolean specifying whether the cloud logs are printed out to the terminal. Available in `k6 cloud run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--show-logs`| N/A| `true`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 cloud run --show-logs=false script.js

## Stages

A list of VU `{ target: ..., duration: ... }` objects that specify the target number of VUs to ramp up or down to for a specific period. Available in `k6 run` and `k6 cloud run` commands.

It is a shortcut option for a single [scenario](/docs/k6/latest/using-k6/scenarios/) with a [ramping VUs executor](/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/). If used together with the VUs option, the `vus` value is used as the `startVUs` option of the executor.

> Note
>
> For a single-run smoke or functional test, use `--once`. It runs one iteration with one VU while preserving a single scenario’s behavior and browser settings. `--stage` defines a load ramp and can replace the script’s scenario configuration.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_STAGES`| `--stage <duration>:<target>`, `-s <duration>:<target>`| `stages`| Based on `vus` and `duration`.

JavaScript Bash windows powershell

![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    // The following config would have k6 ramping up from 1 to 10 VUs for 3 minutes,
    // then staying flat at 10 VUs for 5 minutes, then ramping up from 10 to 35 VUs
    // over the next 10 minutes before finally ramping down to 0 VUs for another
    // 3 minutes.

    export const options = {
      stages: [
        { duration: '3m', target: 10 },
        { duration: '5m', target: 10 },
        { duration: '10m', target: 35 },
        { duration: '3m', target: 0 },
      ],
    };

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --stage 5s:10,5m:20,10s:5 script.js

    # or...

    K6_STAGES="5s:10,5m:20,10s:5" k6 run script.js

windows ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --stage 5s:10,5m:20,10s:5 script.js

    # or...

    set "K6_STAGES=5s:10,5m:20,10s:5" && k6 run script.js

powershell ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --stage 5s:10,5m:20,10s:5 script.js

    # or...

    $env:K6_STAGES="5s:10,5m:20,10s:5"; k6 run script.js

## Summary export

> Note
>
> k6 v1.5.0 introduced a new opt-in format available for summary exports, designed for easier integration with external systems and analytics pipelines. You can learn more details about it in the [`handleSummary()` function](/docs/k6/latest/results-output/end-of-test/custom-summary/#summary-data-reference) page.

Save the end-of-test summary report to a JSON file that includes data for all test metrics, checks and thresholds. This is useful to get the aggregated test results in a machine-readable format, for integration with dashboards, external alerts, CI pipelines, etc.

While this feature is not deprecated yet, [we now discourage it](/docs/k6/latest/results-output/end-of-test/#summary-export-to-a-json-file). For a better, more flexible JSON export, as well as export of the summary data to different formats (e.g. JUnit/XUnit/etc. XML, HTML, .txt) and complete summary customization, use the [`handleSummary()` function](/docs/k6/latest/results-output/end-of-test/custom-summary/).

Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_SUMMARY_EXPORT`| `--summary-export <filename>`| N/A| `null`

Bash windows powershell

![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-export export.json script.js

    # or...

    K6_SUMMARY_EXPORT="export.json" k6 run script.js

windows ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-export export.json script.js

    # or...

    set "K6_SUMMARY_EXPORT=export.json" && k6 run script.js

powershell ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-export export.json script.js

    # or...

    $env:K6_SUMMARY_EXPORT="export.json"; k6 run script.js

See an example file on the [Results Output](/docs/k6/latest/get-started/results-output/#summary-export) page.

## Summary mode

Define how detailed the [end-of-test summary](/docs/k6/latest/results-output/end-of-test/) should be. Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_SUMMARY_MODE`| `--summary-mode`| N/A| `"compact"`

The following modes are available:

  * **compact** (default): Shows the most relevant test results in a concise format, focusing on:
    * Thresholds results
    * Checks results
    * Aggregated metrics by category
  * **full** : Shows all available information, including:
    * Everything from compact mode
    * Detailed metrics for each protocol-specific category
    * Group-specific results
    * Scenario-specific results
  * **disabled** : Completely disables the summary generation, including:
    * Calls to [`handleSummary()`](/docs/k6/latest/results-output/end-of-test/custom-summary/)
    * The use of `--summary-export`


Bash windows powershell

![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-mode=full script.js

    # or...

    K6_SUMMARY_MODE="full" k6 run script.js

windows ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-mode=full script.js

    # or...

    set "K6_SUMMARY_MODE=full" && k6 run script.js

powershell ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-mode=full script.js

    # or...

    $env:K6_SUMMARY_MODE="full"; k6 run script.js

## Summary trend stats

Define which stats for [`Trend` metrics](/docs/k6/latest/javascript-api/k6-metrics/trend/) (e.g. response times, group/iteration durations, etc.) will be shown in the [end-of-test summary](/docs/k6/latest/results-output/end-of-test/). Possible values include `avg` (average), `med` (median), `min`, `max`, `count`, as well as arbitrary percentile values (e.g. `p(95)`, `p(99)`, `p(99.99)`, etc.).

For further summary customization and exporting the summary in various formats (e.g. JSON, JUnit/XUnit/etc. XML, HTML, .txt, etc.), use the [`handleSummary()` function](/docs/k6/latest/results-output/end-of-test/custom-summary/).

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_SUMMARY_TREND_STATS`| `--summary-trend-stats`| `summaryTrendStats`| `avg,min,med,max,p(90),p(95)`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99.99)', 'count'],
    };

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --summary-trend-stats="avg,min,med,max,p(90),p(99.9),p(99.99),count" ./script.js

## Summary time unit

Define which time unit will be used for _all_ time values in the [end-of-test summary](/docs/k6/latest/results-output/end-of-test/). Possible values are `s` (seconds), `ms` (milliseconds) and `us` (microseconds). If no value is specified, k6 will use mixed time units, choosing the most appropriate unit for each value.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_SUMMARY_TIME_UNIT`| `--summary-time-unit`| `summaryTimeUnit`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      summaryTimeUnit: 'ms',
    };

## Supply environment variables

Add/override an [environment variable](/docs/k6/latest/using-k6/environment-variables/) with `VAR=value`in a k6 script. Available in `k6 run` and `k6 cloud` commands.

To make the system environment variables available in the k6 script via `__ENV`, use the `--include-system-env-vars` option.

> Note
>
> **The`-e` flag does not configure options.**
>
> This flag just provides variables to the script, which the script can use or ignore. For example, `-e K6_ITERATIONS=120` does _not_ configure the script iterations.
>
> Compare this behavior with `K6_ITERATIONS=120 k6 run script.js`, which _does_ set iterations.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--env`, `-e`| N/A| `null`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run -e FOO=bar ~/script.js

## System tags

Specify which [system tags](/docs/k6/latest/using-k6/tags-and-groups/#system-tags) will be in the collected metrics. Some collectors like the `cloud` one may require that certain system tags be used. You can specify the tags as an array from the JS scripts or as a comma-separated list via the CLI. Available in `k6 run` and `k6 cloud` commands

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_SYSTEM_TAGS`| `--system-tags`| `systemTags`| `proto`,`subproto`,`status`,`method`,`url`,`name`,`group`,`check`,`error`,`error_code`,`tls_version`,`scenario`,`service`,`expected_response`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      systemTags: ['status', 'method', 'url'],
    };

## Tags

Specify tags that should be set test wide across all metrics. If a tag with the same name has been specified on a request, check or custom metrics it will have precedence over a test wide tag. Available in `k6 run` and `k6 cloud` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--tag NAME=VALUE`| `tags`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      tags: {
        name: 'value',
        another: 'different value',
      },
    };

Multiple CLI flags can be provided to set more than one tag at a time:

shell ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --tag name=value --tag another="different value" script.js

## Teardown timeout

Specify how long the `teardown()` function is allowed to run before it’s terminated and the test fails.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_TEARDOWN_TIMEOUT`| N/A| `teardownTimeout`| `"60s"`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      teardownTimeout: '30s',
    };

## Thresholds

A collection of threshold specifications to configure under what condition(s) a test is considered successful or not, when it has passed or failed, based on metric data. To learn more, have a look at the [Thresholds](/docs/k6/latest/using-k6/thresholds/) documentation. Available in `k6 run` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `thresholds`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      thresholds: {
        'http_req_duration': ['avg<100', 'p(95)<200'],
        'http_req_connecting{cdnAsset:true}': ['p(95)<100'],
      },
    };

## Throw

A boolean, true or false, specifying whether k6 should throw exceptions when certain errors occur, or if it should just log them with a warning. Behaviors that currently depend on this option:

  * Failing to make [HTTP requests](/docs/k6/latest/javascript-api/k6-http/), e.g. due to a network error.
  * Adding invalid values to [custom metrics](/docs/k6/latest/using-k6/metrics/#custom-metrics).
  * Setting invalid [per-VU metric tags](/docs/k6/latest/javascript-api/k6-execution/#tags).


Available in `k6 run` and `k6 cloud` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_THROW`| `--throw`, `-w`| `throw`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      throw: true,
    };

## TLS AIA fetch

A boolean, true or false. When enabled, k6 follows the Authority Information Access (AIA) extension on server-presented certificates to fetch missing intermediate CA certificates over HTTP. This lets k6 verify TLS chains against servers that don’t bundle the full chain in their handshake, which browsers do by default but Go’s `crypto/tls` does not.

Fetched intermediates are cached and reused for the lifetime of the test, and AIA fetches respect the same blocking, host override, and DNS rules as regular test traffic. This option has no effect when `insecureSkipTLSVerify` is enabled.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_TLS_AIA_FETCH`| N/A| `tlsAIAFetch`| `false`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      tlsAIAFetch: true,
    };

## TLS auth

A list of TLS client certificate configuration objects. `domains` and `password` are optional, but `cert` and `key` are required.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `tlsAuth`| `null`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      tlsAuth: [
        {
          domains: ['example.com'],
          cert: open('mycert.pem'),
          key: open('mycert-key.pem'),
          password: 'mycert-passphrase',
        },
      ],
    };

## TLS cipher suites

A list of cipher suites allowed to be used by in SSL/TLS interactions with a server. For a full listing of available ciphers go [here](https://golang.org/pkg/crypto/tls/#pkg-constants).

> Caution
>
> Due to limitations in the underlying [go implementation](https://github.com/golang/go/issues/29349), changing the ciphers for TLS 1.3 is _not_ supported and will do nothing.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `tlsCipherSuites`| `null` (Allow all suites)

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      tlsCipherSuites: ['TLS_RSA_WITH_RC4_128_SHA', 'TLS_RSA_WITH_AES_128_GCM_SHA256'],
    };

## TLS version

Either a string representing the only SSL/TLS version allowed to be used in interactions with a server, or an object specifying the “min” and “max” versions allowed to be used.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| N/A| `tlsVersion`| `null` (Allow all versions)

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      tlsVersion: 'tls1.2',
    };

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      tlsVersion: {
        min: 'ssl3.0',
        max: 'tls1.2',
      },
    };

## Traces output

This option specifies where to send traces to. Available in the `k6 run` command.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_TRACES_OUTPUT`| `--traces-output`| N/A| `none`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --traces-output=otel script.js

Possible values are:

  * none - disable
  * otel - send traces to an OTEL compatible backend


### OTEL

Use the `traces-output` option to configure [Open Telemetry](https://opentelemetry.io/) compatible output as follows.

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --traces-output=otel=http://127.0.0.1:4318,proto=http,header.AdditionalHeader=example script.js

Where none of the options are required. The possible keys with their meanings and default values:

Expand table

key| description| default value
---|---|---
`nothing`| the endpoint to which send traces to| `http://127.0.0.1:4317`
proto| the protocol to use when connecting with the traces backend| `grpc`
header.`headerName`| adds an additional HTTP header with the provided header name and value to each HTTP request made to the traces backend| N/A

## User agent

A string specifying the user-agent string to use in `User-Agent` headers when sending HTTP requests. If you pass an empty string, no `User-Agent` header is sent. Available in `k6 run` and `k6 cloud` commands

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_USER_AGENT`| `--user-agent`| `userAgent`| `Grafana k6/<K6_VERSION>`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      userAgent: 'MyK6UserAgentString/1.0',
    };

## Verbose

A boolean specifying whether verbose logging is enabled. Available in `k6 run` and `k6 cloud` commands.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
N/A| `--verbose`, `-v`| N/A| `false`

Bash ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    k6 run --verbose script.js

## VUs

An integer value specifying the number of VUs to run concurrently, used together with the iterations or duration options. If you’d like more control look at the `stages` option or [scenarios](/docs/k6/latest/using-k6/scenarios/).

Available in `k6 run` and `k6 cloud` commands.

> Note
>
> To run an existing script with one VU and one iteration, use `--once`. It preserves a single scenario’s function and settings, including browser options. Setting `--vus 1` alone does not preserve a script-defined scenario.

Expand table

Env| CLI| Code / Config file| Default
---|---|---|---
`K6_VUS`| `--vus`, `-u`| `vus`| `1`

JavaScript ![Copy code to clipboard](/media/images/icons/icon-copy-small-2.svg) Copy


    export const options = {
      vus: 10,
      duration: '1h',
    };

When you pass `--vus N` on its own (without `--duration`, `--iterations`, or `--stage`), k6 creates a single [shared-iterations](/docs/k6/latest/using-k6/scenarios/executors/shared-iterations/) scenario with `N` VUs and `N` iterations. This overrides any scenarios defined in the script and prints a warning, consistent with how `--duration`, `--iterations`, and `--stage` behave.
