# Voice patterns

Pattern library for calibrating documentation voice against real text.
Every quote is verbatim; the footnote points at the corpus file or the external page it came from.
These are **style models, not content sources**: copy the voice and structure, not the examples, commands, or project-specific facts.
Read the patterns here first; grep the corpus or follow the footnote link only when a pattern needs more context.
Corpus inventory, provenance, and licenses: the [Corpus](#corpus) section below and [NOTICE](NOTICE).

## Machine-writing patterns

Generated text is recognizable by pattern.
Each entry names the failure, then shows what the corpus does instead.

### Announce the artifact, not the document

**Problem:** "In this document, we will explore…" promises content instead of stating it; the first sentence should name the artifact and the goal.

**Good examples:**

- "Set up and deploy your first Worker with Wrangler, the Cloudflare Developer Platform CLI." [^tutorial-cloudflare]
- "The Gatsby command line interface (CLI) is the main tool you use to initialize, build and develop Gatsby sites." [^ref-gatsby-cli]
- "Over the course of this Tutorial, you'll build and deploy your first Gatsby site: a blog site with support for images and MDX! … Here's a finished example of the site you'll build." [^tutorial-gatsby]

### Intensifiers do not describe behavior

**Problem:** "Seamlessly", "robustly", "powerfully" describe nothing; the mechanism is the description.

**Good examples:**

- "A boolean, true or false, specifying whether the k6 process should linger around after test run completion." [^ref-k6-options]
- "Control whether project styles are sent to the browser in a separate css file or inlined into `<style>` tags." [^ref-astro-config]

### Hedges name nothing

**Problem:** "May vary" and "generally recommended" hide the deciding variable; name the variable, the party, or the rule.

**Good examples:**

- "Your internet download speed will affect how long this command takes to run." [^tutorial-gatsby]
- "Because there is no guarantee that any two user requests will be routed to the same or a different instance of your Worker, Cloudflare recommends you do not use or mutate global state." [^expl-cloudflare]
- "Trailing slashes on prerendered pages are handled by the hosting platform, and may not respect your chosen configuration." [^ref-astro-config]

### Lists carry items that exist

**Problem:** "Fast, secure, and intuitive" advertises properties the reader cannot check; list steps, options, or facts of the product.

**Good examples:**

- "k6 supports three execution modes to run a k6 test: local, distributed, and cloud." [^howto-running-k6]
- "`random`: pick a random IP for every new connection." [^ref-k6-options]

### Connectives replace content

**Problem:** "Furthermore", "Moreover", "Additionally" survive deletion without loss; move on a named mechanism instead.

**Good examples:**

- "After you know that the script works and the system responds correctly to minimal load, you can move on to average-load tests. From there, you can progress to more complex load patterns." [^expl-k6-tests]
- "The kubelet then reads from that volume before starting the app container." [^expl-k8s-config]
- "Then, for data that is of a more dynamic nature, you can request data from another service like an API with `fetch` or a library like `axios`." [^expl-gatsby-data]

### Checkpoints, not reassurance

**Problem:** "That worked!" cannot fail; show the command and its literal output instead.

**Good examples:**

- "After it finishes, you should see a message like this:" [^tutorial-gatsby]
- "You added 8 messages to the queue." [^howto-k8s-workqueue]
- "Then, save the file and reload the page. Your Worker's output will have changed to the new text." [^tutorial-cloudflare]

### Endings point forward

**Problem:** "In summary, we covered…" repeats the body; close with the next rule, page, or caveat.

**Good examples:**

- "To understand how statically generated content can turn into a React app, refer to the Understanding React Hydration guide" [^expl-gatsby-data]
- "If the number of completions is set to less than the number of items in the queue, then not all items will be processed." [^howto-k8s-workqueue]
- "You may be interested in other projects (both used in production and proof-of-concepts) that illustrate this usage:" [^expl-gatsby-data]

### Bounded scope claims

**Problem:** "Build anything you can imagine" promises more than any product can document; state the exact condition.

**Good examples:**

- "The site name should only consist of letters and numbers. If you specify a `.`, `./` or a `<space>` in the name, `gatsby new` will throw an error." [^ref-gatsby-cli]
- "This option has no effect when `insecureSkipTLSVerify` is enabled." [^ref-k6-options]
- "These features only exist for pages rendered on demand (SSR) using `server` mode or pages that opt out of prerendering in `static` mode." [^ref-astro-config]

### Personality carries a fact

**Problem:** Warmth that comments on the writing gets cut; keep warmth that asserts something true about the material.

**Good examples:**

- "(If that doesn't mean anything to you now, that's okay! It will by the time you reach the end.)" [^tutorial-gatsby]
- "Congratulations, you're now the owner of a brand-new Gatsby site!" [^tutorial-gatsby]
- "Sit back and enjoy the slideshow as Ubuntu installs in the background!" [^howto-ubuntu]

### Declarative sentences, one idea each

**Problem:** One idea per sentence, active voice; chains of clauses blur.

**Good examples:**

- "A StatefulSet defaults to creating its Pods in a strict order." [^tutorial-k8s-stateful]
- "Init code runs first and is called only once per VU. The `default` code runs as many times or as long as is configured in the test options." [^howto-running-k6]
- "Scaling up means adding more replicas." [^tutorial-k8s-stateful]

## Tutorials

### State the artifact and its scope

**Problem:** A tutorial names what the reader will build and where the tutorial stops.

**Good examples:**

- "In order to demonstrate the basic features of a StatefulSet, and not to conflate the former topic with the latter, you will deploy a simple web application using a StatefulSet." [^tutorial-k8s-stateful]
- "This tutorial shows you how to deploy a WordPress site and a MySQL database using Minikube. Both applications use PersistentVolumes and PersistentVolumeClaims to store data." [^tutorial-k8s-wordpress]
- "Over the course of this Tutorial, you'll build and deploy your first Gatsby site: a blog site with support for images and MDX! … Here's a finished example of the site you'll build." [^tutorial-gatsby]

### List the objectives before the steps

**Problem:** Objectives are skills to reach, not features to see.

**Good examples:**

- "Understand the need for sidecar containers" [^tutorial-k8s-sidecar]
- "Create PersistentVolumeClaims and PersistentVolumes" [^tutorial-k8s-wordpress]
- "After this tutorial, you will be familiar with the following." [^tutorial-k8s-stateful]

### State prerequisites with verified fallbacks

**Problem:** Name what must exist, then name what to do when it does not.

**Good examples:**

- "You need to have a Kubernetes cluster, and the kubectl command-line tool must be configured to communicate with your cluster. It is recommended to run this tutorial on a cluster with at least two nodes that are not acting as control plane hosts. If you do not already have a cluster, you can create one by using minikube or you can use one of these Kubernetes playgrounds:" [^tutorial-k8s-stateful]
- "Your Kubernetes server must be at or later than version 1.29. To check the version, enter `kubectl version`." [^tutorial-k8s-sidecar]
- "If you had trouble globally installing `gatsby-cli` in Part 0, you can also create a new site by running `npm init gatsby` from the command line instead of `gatsby new`." [^tutorial-gatsby]

### Steps carry one action each and name their context

**Problem:** One action per step; the context (which window, which prompt) travels with it.

**Good examples:**

- "To install Ubuntu Desktop, write your downloaded ISO to a USB stick to create the installation media. This is not the same as copying the ISO and requires some special software." [^howto-ubuntu]
- "When the prompt asks, “What would you like to call your site?” enter a name for your site." [^tutorial-gatsby]
- "Open a terminal window and run C3 to create your Worker project." [^tutorial-cloudflare]

### Close every command at a checkpoint

**Problem:** Every command ends with a comprehensible, literal result.

**Good examples:**

- "The `gatsby new` command will start building your site. Your internet download speed will affect how long this command takes to run. After it finishes, you should see a message like this:" [^tutorial-gatsby]
- "Go to http://localhost:8787 to view your Worker." [^tutorial-cloudflare]
- "Preview your Worker at `<YOUR_WORKER>.<YOUR_SUBDOMAIN>.workers.dev`." [^tutorial-cloudflare]

### Show the way out as a step of its own

**Problem:** Cleanup and exits are steps, not footnotes.

**Good examples:**

- "You should have two terminals open, ready for you to run `kubectl` commands as part of cleanup" [^tutorial-k8s-stateful]
- "Run the following command to delete your Secret, Deployments, Services and PersistentVolumeClaims:" [^tutorial-k8s-wordpress]
- "sts is an abbreviation for statefulset" [^tutorial-k8s-stateful]

### Bind a deployment path; name alternatives

**Problem:** One deployment route, bound to a concrete trigger, with the literal destination named.

**Good examples:**

- "When you push a new commit to the `main` branch of the GitHub repository for your site, Netlify will detect the changes, rebuild a new version of your site, and then redeploy it." [^tutorial-gatsby]
- "Deploy your Worker via Wrangler to a `*.workers.dev` subdomain or a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)." [^tutorial-cloudflare]

## How-to guides

### Open with the outcomes and the prerequisite

**Problem:** Outcome first, then the one thing that must already be true.

**Good examples:**

- "Follow along to learn how to: 1. Run a test. 2. Add virtual users. 3. Increase the test duration. 4. Ramp the number of requests up and down as the test runs." [^howto-running-k6]
- "In this example, you will run a Kubernetes Job with multiple parallel worker processes." [^howto-k8s-workqueue]
- "This page shows you how to create, edit, manage, and delete Kubernetes [Secrets](/docs/concepts/configuration/secret/ "Stores sensitive information, such as passwords, OAuth tokens, and ssh keys.") using the `kubectl` command-line tool." [^howto-k8s-secrets]

### Repeat the command for every environment the reader is in

**Problem:** The same step again per shell, tab, or platform; no guessing required.

**Good examples:**

- "Create and initialize a new script by running the following command:" [^howto-running-k6]
- "read `stdin` by passing the file name as `-`" [^howto-running-k6]

### Migrate the reader from commands to configuration

**Problem:** After the commands work, move the values into a file the reader can keep.

**Good examples:**

- "Instead of typing `--vus 10` and `--duration 30s` each time you run the script, you can set the options in your JavaScript file:" [^howto-running-k6]
- "Then import your newly created hook, like so:" [^howto-usestaticquery]

### State the minimum theory right before the example

**Problem:** A definition or mechanism earns its two sentences when the example that follows needs them.

**Good examples:**

- "`useStaticQuery` is a React Hook. All the Rules of Hooks apply. … It takes your GraphQL query and returns the requested data. That's it!" [^howto-usestaticquery]
- "A `Secret` object stores sensitive data such as credentials used by Pods to access services. For example, you might need a Secret to store the username and password needed to access a database." [^howto-k8s-secrets]
- "The [context](/en/reference/api-reference/) object includes information to be made available to other middleware, API routes and `.astro` routes during the rendering process." [^howto-middleware]

### Verification carries the literal output

**Problem:** The reader compares their screen against text, not against a feeling.

**Good examples:**

- "Check that the Secret was created:" … "The output is similar to:" [^howto-k8s-secrets]
- "This will result in the following console order: Terminal window validation request auth request greeting request greeting response auth response validation response" [^howto-middleware]
- "Pods Statuses: 0 Running / 8 Succeeded / 0 Failed" [^howto-k8s-workqueue]

### State the boundary between lookalikes

**Problem:** Name the condition that separates this approach from the one it resembles.

**Good examples:**

- "However, page queries can only be made in **top-level page components**." [^howto-usestaticquery]
- "This rendering occurs at build time for all prerendered pages, but occurs when the route is requested for pages rendered on demand" [^howto-middleware]
- "This approach creates a pod for every work item. If your work items only take a few seconds, though, creating a Pod for every work item may add a lot of overhead. Consider another design, such as in the [fine parallel work queue example](/docs/tasks/job/fine-parallel-processing-work-queue/), that executes multiple work items per Pod." [^howto-k8s-workqueue]

### Troubleshooting carries commands at the point of failure

**Problem:** The rescue lives inside the step that fails, not in a sympathetically worded section elsewhere.

**Good examples:**

- "If your middleware does not run successfully, then you will not have access to `Astro.locals` to render your 500 page." [^howto-middleware]
- "If you have issues with this step or you do not have access to a browser interface, refer to the <a href="https://developers.cloudflare.com/workers/wrangler/commands/general/#login"><code>wrangler login</code></a> documentation." [^tutorial-cloudflare]
- "Some PCs use Intel RST (Rapid Storage Technology), which is not supported by Ubuntu. If this is the case, you will not be able to proceed beyond this point without disabling RST in the BIOS menu of your machine." [^howto-ubuntu]

## Reference

### Open with the contract

**Problem:** State what the thing is for and how it behaves, before any field tables.

**Good examples:**

- "Config holds the information needed to build connect to remote kubernetes clusters as a given user" [^ref-kubeconfig]
- "Options define test-run behavior. Most options can be passed in multiple places. If an option is defined in multiple places, k6 chooses the value from the highest order of precedence." [^ref-k6-options]
- "The following reference covers all supported configuration options in Astro. To learn more about configuring Astro, read our guide on Configuring Astro." [^ref-astro-config]

### Give the syntax, then the tokens

**Problem:** The command form first, then one line per parameter that names what it does.

**Good examples:**

- "Use the following syntax to run `kubectl` commands from your terminal window:" [^ref-kubectl]
- "`command`: Specifies the operation that you want to perform on one or more resources, for example `create`, `get`, `describe`, `delete`." [^ref-kubectl]
- "The first argument (e.g. `my-new-blog`) is the name of your site, and the second argument is the GitHub URL of the starter you want to clone." [^ref-gatsby-cli]

### Carry the interface in tables

**Problem:** Options and fields live in table cells, not in sentences.

**Good examples:**

- "`K6_ITERATIONS`| `--iterations`, `-i`| `iterations`| `1`" [^ref-k6-options]
- "Set port. Defaults to `env.PORT` or `8000`" [^ref-gatsby-cli]
- "kubectl create -f FILENAME [flags]" [^ref-kubectl]

### Type, default, behavior: for each option

**Problem:** Under one heading, in that order, with nothing left to guess.

**Good examples:**

- "Type: `number`" … "Default: `4321`" … "Set which port the server should listen on." … "If the given port is already in use, Astro will automatically try the next available port." [^ref-astro-config]
- "**Type:** `'always' | 'never' | 'ignore'` **Default:** `'ignore'` Set the route matching behavior for trailing slashes in the dev server and on-demand rendered pages." [^ref-astro-config]

### Defaults live in the table, not in adjectives

**Problem:** The default value is data; put it in the column where the reader looks for it.

**Good examples:**

- "Type: `string | boolean`" … "Default: `false`" [^ref-astro-config]
- "do not expose on a network IP address" [^ref-astro-config]
- "listen on all addresses, including LAN and public addresses" [^ref-astro-config]
- "For configuration, `kubectl` looks for a file named `config` in the `$HOME/.kube` directory. You can specify other kubeconfig files by setting the `KUBECONFIG` environment variable or by setting the `--kubeconfig` flag." [^ref-kubectl]

### Point to where the deeper detail lives

**Problem:** Name the next document and what it adds, not "see the docs".

**Good examples:**

- "All the following documentation is available in the tool by running `gatsby --help`." [^ref-gatsby-cli]
- "For details about each command, including all the supported flags and subcommands, see the [kubectl](/docs/reference/kubectl/generated/kubectl/) reference documentation." [^ref-kubectl]
- "See the client.authentication.k8s.io API group for specifications of the exact input and output format" [^ref-kubeconfig]

### Cover the edges

**Problem:** Precedence, cross-option effects, and alternatives are stated where the option is defined.

**Good examples:**

- "If an option is defined in multiple places, k6 chooses the value from the highest order of precedence" [^ref-k6-options]
- "When you pass `--vus N` on its own (without `--duration`, `--iterations`, or `--stage`), k6 creates a single shared-iterations scenario with `N` VUs and `N` iterations." [^ref-k6-options]
- "To use the Gatsby CLI you must either: Install it globally with `npm install -g gatsby-cli`, where you execute commands with the syntax `gatsby new`, or Run commands directly with `npx`, where you execute commands with the syntax `npx gatsby new`" [^ref-gatsby-cli]

## Explanations

### Define the objects before the system

**Problem:** Each thing gets its definition as it enters the story, before any mechanism depends on it.

**Good examples:**

- "A ConfigMap is an API object used to store non-confidential data in key-value pairs." [^expl-k8s-config]
- "V8 orchestrates isolates: lightweight contexts that provide your code with variables it can access and a safe environment to be executed within. You could even consider an isolate a sandbox for your function to run in." [^expl-cloudflare]
- "Extensions are software components that extend and deeply integrate with Kubernetes. They adapt it to support new types and new kinds of hardware." [^expl-k8s-extending]

### State the system's starting problem

**Problem:** Open on the constraint or risk the system exists to handle, not on a feature list.

**Good examples:**

- "Though Cloudflare Workers behave similarly to JavaScript in the browser or in Node.js, there are a few differences in how you have to think about your code." [^expl-cloudflare]
- "But a good load-testing strategy requires more than just executing a single script." [^expl-k6-tests]
- "Many things can go wrong when a system is under load. The system must run numerous operations simultaneously and respond to different requests from a variable number of users." [^expl-k6-tests]

### Compare alternatives in one table or one sentence

**Problem:** The distinction between options is carried by the options themselves.

**Good examples:**

- "Smoke | Low | Short (seconds or minutes) | When the relevant system or application code changes." [^expl-k6-tests]
- "Kubernetes provides two main API kinds that you can use to store configuration, ready for a Pod (or other component) to load and use: ConfigMap, and Secret." [^expl-k8s-config]
- "Customization approaches can be broadly divided into [configuration](#configuration), which only involves changing command line arguments, local configuration files, or API resources; and [extensions](#extensions), which involve running additional programs, additional network services, or both." [^expl-k8s-extending]

### Bound the claim in the same paragraph

**Problem:** No claim leaves its paragraph without its limit, condition, or scope attached.

**Good examples:**

- "Start with smoke tests, then progress to higher loads and longer durations." [^expl-k6-tests]
- "StatefulSets are intended to be used with stateful applications and distributed systems. However, the administration of stateful applications and distributed systems on Kubernetes is a broad, complex topic." [^tutorial-k8s-stateful]
- "This is a significant undertaking, and almost all Kubernetes users find they do not need to modify the scheduler." [^expl-k8s-extending]

### Say what the reader must do differently because of it

**Problem:** Every explanation lands on an implication for the reader's own work.

**Good examples:**

- "it is generally advised that you not store mutable state in your global scope unless you have accounted for this contingency." [^expl-cloudflare]
- "Compiling pages at build time is useful when your website content won't change often, or when triggering a build process to recompile works fine. However, some websites with more dynamic needs require a client-side runtime to handle constantly changing content after the page loads, like a chat widget, user upvotes, or an email client web application." [^expl-gatsby-data]
- "You typically don't have to write the configuration out once per Pod, and you should design applications where possible so that they can work with shared configuration." [^expl-k8s-config]

## Flow

1. Pick the quadrant: tutorial, how-to, reference, or explanation.
2. Read the constraints first: the checker configuration and its limits
   (line and table widths, frontmatter, links) and the repo's style guide.
   Constraints discovered after a rewrite force a second rewrite.
3. Read the patterns for your quadrant here; when one needs a concrete match,
   grep the corpus for the cited passage (see [Corpus](#corpus) below), or follow
   the external link for a source that is not vendored. Do not read whole
   exemplar pages.
4. Extract the structural patterns at sentence and paragraph level (heading hierarchy, opener shape, paragraph flow, list-versus-prose choices, table use, step format), and draft against those, not against the content. Sentence-level fixes alone do not make a page sound like its quadrant.
5. Check every paragraph against the machine-writing patterns; delete sentences that carry no information.
6. Run whatever prose and markdown checkers the project keeps.

## Corpus

Eighteen pages from projects whose documentation runs on Diátaxis, at least four per quadrant, in [example-text/](example-text/).
Each file's frontmatter records the URL it was fetched from.
Use this table to find the source for a grepped passage; the patterns above are the default reading.

| Quadrant    | File                                                       | Source project     |
| ----------- | ---------------------------------------------------------- | ------------------ |
| tutorials   | [pod-sidecar-containers.k8s.md][]                          | Kubernetes         |
| tutorials   | [mysql-wordpress-persistent-volume-statefulset.k8s.md][]   | Kubernetes         |
| tutorials   | [stateful-set-basics.k8s.md][]                             | Kubernetes         |
| tutorials   | [create-and-deploy-your-first-gatsby-site.gatsby.md][]     | Gatsby             |
| tutorials   | [deploy-your-first-worker.cloudflare.md][]                 | Cloudflare Workers |
| how-to      | [managing-secrets-using-kubectl.k8s.md][]                  | Kubernetes         |
| how-to      | [coarse-parallel-processing-using-a-work-queue.k8s.md][]   | Kubernetes         |
| how-to      | [ubuntu-install-ubuntu-desktop.ubuntu.md][]                | Ubuntu tutorials   |
| how-to      | [query-data-in-components-with-usestaticquery.gatsby.md][] | Gatsby             |
| how-to      | [middleware.astro.md][]                                    | Astro              |
| reference   | [kubeconfig-v1.k8s.md][]                                   | Kubernetes         |
| reference   | [kubectl-reference.k8s.md][]                               | Kubernetes         |
| reference   | [gatsby-cli.gatsby.md][]                                   | Gatsby             |
| reference   | [configuration-reference.astro.md][]                       | Astro              |
| explanation | [configuration.k8s.md][]                                   | Kubernetes         |
| explanation | [extending-kubernetes.k8s.md][]                            | Kubernetes         |
| explanation | [build-time-and-client-runtime-data-fetching.gatsby.md][]  | Gatsby             |
| explanation | [how-workers-works.cloudflare.md][]                        | Cloudflare Workers |

### Linked sources

Three Grafana k6 pages are linked here but not vendored.
Follow the link when a quoted pattern needs more context; do not add the full page to the corpus.

- Grafana k6, *Running k6* — <https://grafana.com/docs/k6/latest/get-started/running-k6/>
- Grafana k6, *Options reference* — <https://grafana.com/docs/k6/latest/using-k6/k6-options/reference/>
- Grafana k6, *Load test types* — <https://grafana.com/docs/k6/latest/testing-guides/test-types/>

### Provenance

Every corpus project publishes a Diátaxis basis for its documentation:

- Kubernetes maps its page content types to the Diátaxis framework in the contribution guide.[^k8s-content-types]
- Gatsby writes, in the docs-contribution guides, that the Gatsby docs are based on the Diátaxis documentation system, and its navigation carries the four quadrant names verbatim.[^gatsby-contributing]
- Cloudflare Developer Docs named Diátaxis their north star for information architecture when rebuilding the docs; their pages follow get-started tutorials, task how-tos, per-option references, and concept pages.[^cloudflare-diataxis]
- Canonical's Ubuntu documentation style guide instructs writers to use Diátaxis to structure product documentation, listing the four document types.[^ubuntu-diataxis]
- Astro divides its docs site into Tutorial, Guides, and Reference groups, and its Starlight theme ships those quadrants as the default template.[^astro-sidebar]

### Caveats

- Style only: these examples calibrate voice and structure, and do not validate facts. Validate every claim against your project's own sources.
- Never copy content: no example tasks, no copy-pasted commands.
- Excerpts are trimmed: quotes are verbatim in wording, but setting and surrounding text are omitted.
- Use a warm sentence only when it carries a fact about the material; cut comments about the writing.

[pod-sidecar-containers.k8s.md]: example-text/tutorials/pod-sidecar-containers.k8s.md
[mysql-wordpress-persistent-volume-statefulset.k8s.md]: example-text/tutorials/mysql-wordpress-persistent-volume-statefulset.k8s.md
[stateful-set-basics.k8s.md]: example-text/tutorials/stateful-set-basics.k8s.md
[create-and-deploy-your-first-gatsby-site.gatsby.md]: example-text/tutorials/create-and-deploy-your-first-gatsby-site.gatsby.md
[deploy-your-first-worker.cloudflare.md]: example-text/tutorials/deploy-your-first-worker.cloudflare.md
[managing-secrets-using-kubectl.k8s.md]: example-text/how-to/managing-secrets-using-kubectl.k8s.md
[coarse-parallel-processing-using-a-work-queue.k8s.md]: example-text/how-to/coarse-parallel-processing-using-a-work-queue.k8s.md
[ubuntu-install-ubuntu-desktop.ubuntu.md]: example-text/how-to/ubuntu-install-ubuntu-desktop.ubuntu.md
[query-data-in-components-with-usestaticquery.gatsby.md]: example-text/how-to/query-data-in-components-with-usestaticquery.gatsby.md
[middleware.astro.md]: example-text/how-to/middleware.astro.md
[kubeconfig-v1.k8s.md]: example-text/reference/kubeconfig-v1.k8s.md
[kubectl-reference.k8s.md]: example-text/reference/kubectl-reference.k8s.md
[gatsby-cli.gatsby.md]: example-text/reference/gatsby-cli.gatsby.md
[configuration-reference.astro.md]: example-text/reference/configuration-reference.astro.md
[configuration.k8s.md]: example-text/explanation/configuration.k8s.md
[extending-kubernetes.k8s.md]: example-text/explanation/extending-kubernetes.k8s.md
[build-time-and-client-runtime-data-fetching.gatsby.md]: example-text/explanation/build-time-and-client-runtime-data-fetching.gatsby.md
[how-workers-works.cloudflare.md]: example-text/explanation/how-workers-works.cloudflare.md

[^tutorial-gatsby]: Gatsby, *Create and Deploy Your First Gatsby Site* — [create-and-deploy-your-first-gatsby-site.gatsby.md](example-text/tutorials/create-and-deploy-your-first-gatsby-site.gatsby.md) · <https://www.gatsbyjs.com/docs/tutorial/getting-started/part-1/>
[^tutorial-cloudflare]: Cloudflare Workers, *Deploy your first Worker with the CLI* — [deploy-your-first-worker.cloudflare.md](example-text/tutorials/deploy-your-first-worker.cloudflare.md) · <https://developers.cloudflare.com/workers/get-started/guide/>
[^tutorial-k8s-stateful]: Kubernetes, *StatefulSet Basics* — [stateful-set-basics.k8s.md](example-text/tutorials/stateful-set-basics.k8s.md) · <https://kubernetes.io/docs/tutorials/stateful-set/>
[^tutorial-k8s-sidecar]: Kubernetes, *Adopting Sidecar Containers* — [pod-sidecar-containers.k8s.md](example-text/tutorials/pod-sidecar-containers.k8s.md) · <https://kubernetes.io/docs/tutorials/pod-sidecar-containers/>
[^tutorial-k8s-wordpress]: Kubernetes, *Example: Deploying WordPress and MySQL with Persistent Volumes* — [mysql-wordpress-persistent-volume-statefulset.k8s.md](example-text/tutorials/mysql-wordpress-persistent-volume-statefulset.k8s.md) · <https://kubernetes.io/docs/tutorials/stateful-set/mysql-wordpress-persistent-volume/>
[^howto-running-k6]: Grafana k6, *Running k6* — <https://grafana.com/docs/k6/latest/get-started/running-k6/>
[^howto-usestaticquery]: Gatsby, *Querying Data in Components with the useStaticQuery Hook* — [query-data-in-components-with-usestaticquery.gatsby.md](example-text/how-to/query-data-in-components-with-usestaticquery.gatsby.md) · <https://www.gatsbyjs.com/docs/how-to/querying-data/use-static-query/>
[^howto-middleware]: Astro, *Middleware* — [middleware.astro.md](example-text/how-to/middleware.astro.md) · <https://docs.astro.build/en/guides/middleware/>
[^howto-k8s-secrets]: Kubernetes, *Managing Secrets using kubectl* — [managing-secrets-using-kubectl.k8s.md](example-text/how-to/managing-secrets-using-kubectl.k8s.md) · <https://kubernetes.io/docs/tasks/inject-data-application/managing-secret-using-kubectl/>
[^howto-ubuntu]: Ubuntu, *Install Ubuntu Desktop* — [ubuntu-install-ubuntu-desktop.ubuntu.md](example-text/how-to/ubuntu-install-ubuntu-desktop.ubuntu.md) · <https://ubuntu.com/tutorials/install-ubuntu-desktop>
[^howto-k8s-workqueue]: Kubernetes, *Coarse Parallel Processing Using a Work Queue* — [coarse-parallel-processing-using-a-work-queue.k8s.md](example-text/how-to/coarse-parallel-processing-using-a-work-queue.k8s.md) · <https://kubernetes.io/docs/tasks/batch/coarse-parallel-processing-work-queue/>
[^ref-k6-options]: Grafana k6, *Options reference* — <https://grafana.com/docs/k6/latest/using-k6/k6-options/reference/>
[^ref-astro-config]: Astro, *Configuration Reference* — [configuration-reference.astro.md](example-text/reference/configuration-reference.astro.md) · <https://docs.astro.build/en/reference/configuration-reference/>
[^ref-kubectl]: Kubernetes, *Command line tool (kubectl)* — [kubectl-reference.k8s.md](example-text/reference/kubectl-reference.k8s.md) · <https://kubernetes.io/docs/reference/kubectl/>
[^ref-gatsby-cli]: Gatsby, *Commands (Gatsby CLI)* — [gatsby-cli.gatsby.md](example-text/reference/gatsby-cli.gatsby.md) · <https://www.gatsbyjs.com/docs/reference/gatsby-cli/>
[^ref-kubeconfig]: Kubernetes, *kubeconfig (v1)* — [kubeconfig-v1.k8s.md](example-text/reference/kubeconfig-v1.k8s.md) · <https://kubernetes.io/docs/reference/config-api/kubeconfig.v1/>
[^expl-k6-tests]: Grafana k6, *Load test types* — <https://grafana.com/docs/k6/latest/testing-guides/test-types/>
[^expl-gatsby-data]: Gatsby, *Build Time and Client Runtime Data Fetching* — [build-time-and-client-runtime-data-fetching.gatsby.md](example-text/explanation/build-time-and-client-runtime-data-fetching.gatsby.md) · <https://www.gatsbyjs.com/docs/conceptual/data-fetching/>
[^expl-cloudflare]: Cloudflare Workers, *How Workers works* — [how-workers-works.cloudflare.md](example-text/explanation/how-workers-works.cloudflare.md) · <https://developers.cloudflare.com/workers/reference/how-workers-works/>
[^expl-k8s-config]: Kubernetes, *Configuration* — [configuration.k8s.md](example-text/explanation/configuration.k8s.md) · <https://kubernetes.io/docs/concepts/configuration/>
[^expl-k8s-extending]: Kubernetes, *Extending Kubernetes* — [extending-kubernetes.k8s.md](example-text/explanation/extending-kubernetes.k8s.md) · <https://kubernetes.io/docs/concepts/extend-kubernetes/>
[^k8s-content-types]: Kubernetes, *Page content types* — <https://kubernetes.io/docs/contribute/style/page-content-types/>
[^gatsby-contributing]: Gatsby, *How to Write a Conceptual Guide* (docs-contribution guides) — <https://www.gatsbyjs.com/contributing/docs-contributions/how-to-write-a-conceptual-guide>
[^cloudflare-diataxis]: Diátaxis, adopted-testimony homepage — <https://www.diataxis.fr/>
[^ubuntu-diataxis]: Canonical, *Documentation Style Guide* — <https://documentation.ubuntu.com/style-guide/>
[^astro-sidebar]: Astro docs sidebar source (`astro.sidebar.ts`) — <https://github.com/withastro/docs/blob/main/astro.sidebar.ts> · Starlight sidebar guide — <https://starlight.astro.build/guides/sidebar/>
