---
type: explanation
source: https://kubernetes.io/docs/concepts/configuration/
title: Configuration
domain: kubernetes
---

# Configuration

Configuration mechanisms within Kubernetes.

Kubernetes provides ways to *separate configuration from code*. This is a common practice that aligns with DevOps as a practice, and with cloud native architecture.

If you have a [container image](/docs/reference/glossary/?all=true#term-image "Stored instance of a container that holds a set of software needed to run an application.") that allows separate configuration, you can deploy the **same** application code in different contexts. For example, you can run tests against the built image, and then run that exact same image in a production context. Doing that gives you better confidence in your testing, compared with if you deployed the application one way for tests and a different way in production.

To learn about configuring the `kubectl` command-line tool, read [configure access to multiple clusters](/docs/tasks/access-application-cluster/configure-access-multiple-clusters/).

## Kubernetes configuration-related APIs

Kubernetes provides two main API kinds that you can use to store configuration, ready for a Pod (or other component) to load and use: [ConfigMap](/docs/concepts/configuration/configmap/), and [Secret](/docs/concepts/configuration/secret/).

The special-use [CertificateSigningRequest](/docs/reference/access-authn-authz/certificate-signing-requests/#certificate-signing-requests) and [ClusterTrustBundle](/docs/reference/access-authn-authz/certificate-signing-requests/#cluster-trust-bundles) API kinds also hold configuration data that's relevant to some specific cases, such as TLS configuration.

All of these configuration mechanisms, even for certificates, are designed so that configuration can be reused and shared across multiple Pods. You typically don't have to write the configuration out once per Pod, and you should design applications where possible so that they can work with shared configuration.

To learn about using configuration in your applications, read [inject data into applications](/docs/tasks/inject-data-application/).

### ConfigMaps

A ConfigMap is an API object used to store non-confidential data in key-value pairs. [Pods](/docs/concepts/workloads/pods/ "A Pod represents a set of running containers in your cluster.") can consume ConfigMaps as environment variables, command-line arguments, or as configuration files in a [volume](/docs/concepts/storage/volumes/ "A directory containing data, accessible to the containers in a pod.").

A ConfigMap allows you to decouple environment-specific configuration from your [container images](/docs/reference/glossary/?all=true#term-image "Stored instance of a container that holds a set of software needed to run an application."), so that your applications are easily portable.

### Secrets

A Secret is an object that contains an amount of confidential data, such as a password, a token, or a key.

Secrets are similar to [ConfigMaps](/docs/concepts/configuration/configmap/ "An API object used to store non-confidential data in key-value pairs. Can be consumed as environment variables, command-line arguments, or configuration files in a volume.") but are specifically intended to hold confidential data. Read the page about [Secrets](/docs/concepts/configuration/secret/) to learn about the benefits (and limitations) around information security and Secrets.

## Configuration via sidecar containers or init containers

You can also use an [init container](/docs/concepts/workloads/pods/init-containers/ "One or more initialization containers that must run to completion before any app containers run.") or a [sidecar container](/docs/concepts/workloads/pods/sidecar-containers/ "An auxilliary container that stays running throughout the lifecycle of a Pod.") to provide configuration to your workload.

This is useful if you already have some means, outside of Kubernetes, to store configuration or security keys or other information that your containers must use, and that shouldn't be stored in container images.

### Sidecar container helper

A *sidecar* configuration helper runs in the same Pod as the application container, so each Pod has its own sidecar. A typical configuration sidecar fetches configuration data over the Pod network, and then writes it into a [volume](/docs/concepts/storage/volumes/ "A directory containing data, accessible to the containers in a pod.") that is mounted into both containers.

There are many variations on this basic pattern, that still have a helper container writing configuration for the app container to consume.

### Init container helper

Pods can have *init* containers that start before the main application. Unlike sidecars, init containers complete before the Pod's main (application) containers start up, so the configuration only gets set once.

You have two main options for configuration using init containers:

#### Configuration via the filesystem

With this option, the init container fetches configuration and writes the configuration to a file, or several files, typically to a Pod-local [volume](/docs/concepts/storage/volumes/ "A directory containing data, accessible to the containers in a pod.").

#### Configuration via environment variables

Feature state: Beta since Kubernetes v1.35; enabled by default

This is done using a local volume, but only the init container mounts that volume. The kubelet then reads from that volume before starting the app container.

Read [Define Environment Variable Values Using An Init Container](/docs/tasks/inject-data-application/define-environment-variable-via-file/) to learn more.

## Cluster configuration

This section of the documentation is about configuration. However, if you are doing platform-level or cluster-level configuration, read the [cluster administration](/docs/concepts/cluster-administration/) pages and look through the list of [cluster administration tasks](/docs/tasks/administer-cluster/).

## What's next

The following links are all relevant to the overall idea of *configuration* and Kubernetes:

-   [Configure Pods and Containers](/docs/tasks/configure-pod-container/)
-   [Inject Data Into Applications](/docs/tasks/inject-data-application/)
-   [Policies](/docs/concepts/policy/), another form of configuration
-   [Management of Kubernetes Objects Using Configuration Files](/docs/tasks/manage-kubernetes-objects/declarative-config/), which is about Kubernetes [manifests](/docs/reference/glossary/?all=true#term-manifest "A serialized specification of one or more Kubernetes API objects.")
    -   [Kubernetes Object Management](/docs/concepts/overview/working-with-objects/object-management/) is also about object management / configuration
-   [Configure Redis Using A ConfigMap](/docs/tutorials/configuration/configure-redis-using-configmap/) (a tutorial)
-   [Updating Configuration via a ConfigMap](/docs/tutorials/configuration/updating-configuration-via-a-configmap/) (another tutorial)

and you can review the [list of configuration file formats](/docs/reference/config-api/) in the reference section.

Within **this** section of the documentation, you can read about:

-   [ConfigMaps](/docs/concepts/configuration/configmap/)
-   [Secrets](/docs/concepts/configuration/secret/)
-   [Resource Management for Pods and Containers](/docs/concepts/configuration/manage-resources-containers/)
-   [Organizing Cluster Access Using kubeconfig Files](/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
-   [Resource Management for Windows nodes](/docs/concepts/configuration/windows-resource-management/)
