---
type: tutorial
source: https://kubernetes.io/docs/tutorials/pod-sidecar-containers/
title: Adopting Sidecar Containers
domain: kubernetes
---

# Adopting Sidecar Containers

This section is relevant for people adopting a new built-in [sidecar containers](/docs/concepts/workloads/pods/sidecar-containers/) feature for their workloads.

Sidecar container is not a new concept as posted in the [blog post](/blog/2015/06/the-distributed-system-toolkit-patterns/). Kubernetes allows running multiple containers in a Pod to implement this concept. However, running a sidecar container as a regular container has a lot of limitations being fixed with the new built-in sidecar containers support.

Feature state: Stable since Kubernetes v1.33

More information about this feature

This is a stable feature in Kubernetes, and has been since version v1.33. It was first available in the v1.28 release. You can no longer disable or opt out of this feature or behavior (it is locked); if you explicitly set a value for the associated feature gate SidecarContainers, Kubernetes ignores it but does not report any error.

## Objectives

-   Understand the need for sidecar containers
-   Be able to troubleshoot issues with the sidecar containers
-   Understand options to universally "inject" sidecar containers to any workload

## Before you begin

You need to have a Kubernetes cluster, and the kubectl command-line tool must be configured to communicate with your cluster. It is recommended to run this tutorial on a cluster with at least two nodes that are not acting as control plane hosts. If you do not already have a cluster, you can create one by using [minikube](https://minikube.sigs.k8s.io/docs/tutorials/multi_node/) or you can use one of these Kubernetes playgrounds:

-   [iximiuz Labs](https://labs.iximiuz.com/playgrounds?category=kubernetes&filter=all)
-   [Killercoda](https://killercoda.com/playgrounds/scenario/kubernetes)
-   [KodeKloud](https://kodekloud.com/public-playgrounds)

Your Kubernetes server must be at or later than version 1.29.

To check the version, enter `kubectl version`.

## Sidecar containers overview

Sidecar containers are secondary containers that run along with the main application container within the same [Pod](/docs/concepts/workloads/pods/ "A Pod represents a set of running containers in your cluster."). These containers are used to enhance or to extend the functionality of the primary *app container* by providing additional services, or functionalities such as logging, monitoring, security, or data synchronization, without directly altering the primary application code. You can read more in the [Sidecar containers](/docs/concepts/workloads/pods/sidecar-containers/) concept page.

The concept of sidecar containers is not new and there are multiple implementations of this concept. As well as sidecar containers that you, the person defining the Pod, want to run, you can also find that some [addons](/docs/concepts/cluster-administration/addons/ "Resources that extend the functionality of Kubernetes.") modify Pods - before the Pods start running - so that there are extra sidecar containers. The mechanisms to *inject* those extra sidecars are often [mutating webhooks](/docs/reference/access-authn-authz/admission-controllers/#mutatingadmissionwebhook). For example, a service mesh addon might inject a sidecar that configures mutual TLS and encryption in transit between different Pods.

While the concept of sidecar containers is not new, the native implementation of this feature in Kubernetes, however, is new. And as with every new feature, adopting this feature may present certain challenges.

This tutorial explores challenges and solutions that can be experienced by end users as well as by authors of sidecar containers.

## Benefits of a built-in sidecar container

Using Kubernetes' native support for sidecar containers provides several benefits:

1.  You can configure a native sidecar container to start ahead of [init containers](/docs/concepts/workloads/pods/init-containers/ "One or more initialization containers that must run to completion before any app containers run.").
2.  The built-in sidecar containers can be authored to guarantee that they are terminated last. Sidecar containers are terminated with a `SIGTERM` signal once all the regular containers are completed and terminated. If the sidecar container isn’t gracefully shut down, a `SIGKILL` signal will be used to terminate it.
3.  With Jobs, when Pod's `restartPolicy: OnFailure` or `restartPolicy: Never`, native sidecar containers do not block Pod completion. With legacy sidecar containers, special care is needed to handle this situation.
4.  Also, with Jobs, built-in sidecar containers would keep being restarted once they are done, even if regular containers would not with Pod's `restartPolicy: Never`.

See [differences from init containers](/docs/concepts/workloads/pods/sidecar-containers/#differences-from-init-containers) to learn more about it.

## Adopting built-in sidecar containers

The `SidecarContainers` [feature gate](/docs/reference/command-line-tools-reference/feature-gates/) is in beta state starting from Kubernetes version 1.29 and is enabled by default. Some clusters may have this feature disabled or have software installed that is incompatible with the feature.

When this happens, the Pod may be rejected or the sidecar containers may block Pod startup, rendering the Pod useless. This condition is easy to detect as the Pod simply gets stuck on initialization. However, it is often unclear what caused the problem.

Here are the considerations and troubleshooting steps that one can take while adopting sidecar containers for their workload.

### Ensure the feature gate is enabled

As a very first step, make sure that both API server and Nodes are at Kubernetes version v1.29 or later. The feature will break on clusters where Nodes are running earlier versions where it is not enabled.

#### Note

The feature can be enabled on nodes with the version 1.28. The behavior of built-in sidecar container termination was different in version 1.28, and it is not recommended to adjust the behavior of a sidecar to that behavior. However, if the only concern is the startup order, the above statement can be changed to Nodes running version 1.28 with the feature gate enabled.

You should ensure that the feature gate is enabled for the API server(s) within the control plane **and** for all nodes.

One of the ways to check the feature gate enablement is to run a command like this:

-   For API Server:
    
    ```shell
    kubectl get --raw /metrics | grep kubernetes_feature_enabled | grep SidecarContainers
    ```
    
-   For the individual node:
    
    ```shell
    kubectl get --raw /api/v1/nodes/<node-name>/proxy/metrics | grep kubernetes_feature_enabled | grep SidecarContainers
    ```
    

If you see something like this:

```
kubernetes_feature_enabled{name="SidecarContainers",stage="BETA"} 1
```

it means that the feature is enabled.

### Check for 3rd party tooling and mutating webhooks

If you experience issues when validating the feature, it may be an indication that one of the 3rd party tools or mutating webhooks are broken.

When the `SidecarContainers` feature gate is enabled, Pods gain a new field in their API. Some tools or mutating webhooks might have been built with an earlier version of Kubernetes API.

If tools pass unknown fields as-is using various patching strategies to mutate a Pod object, this will not be a problem. However, there are tools that will strip out unknown fields; if you have those, they must be recompiled with the v1.28+ version of Kubernetes API client code.

The way to check this is to use the `kubectl describe pod` command with your Pod that has passed through mutating admission. If any tools stripped out the new field (`restartPolicy:Always`), you will not see it in the command output.

If you hit an issue like this, please advise the author of the tools or the webhooks use one of the patching strategies for modifying objects instead of a full object update.

#### Note

Mutating webhook may update Pods based on some conditions. Thus, sidecar containers may work for some Pods and fail for others.

### Automatic injection of sidecars

If you are using software that injects sidecars automatically, there are a few possible strategies you may follow to ensure that native sidecar containers can be used. All strategies are generally options you may choose to decide whether the Pod the sidecar will be injected to will land on a Node supporting the feature or not.

As an example, you can follow [this conversation in Istio community](https://github.com/istio/istio/issues/48794). The discussion explores the options listed below.

1.  Mark Pods that land to nodes supporting sidecars. You can use node labels and node affinity to mark nodes supporting sidecar containers and Pods landing on those nodes.
2.  Check Nodes compatibility on injection. During sidecar injection, you may use the following strategies to check node compatibility:
    -   query node version and assume the feature gate is enabled on the version 1.29+
    -   query node prometheus metrics and check feature enablement status
    -   assume the nodes are running with a [supported version skew](/releases/version-skew-policy/#supported-version-skew) from the API server
    -   there may be other custom ways to detect nodes compatibility.
3.  Develop a universal sidecar injector. The idea of a universal sidecar injector is to inject a sidecar container as a regular container as well as a native sidecar container. And have a runtime logic to decide which one will work. The universal sidecar injector is wasteful, as it will account for requests twice, but may be considered as a workable solution for special cases.
    -   One way would be on start of a native sidecar container detect the node version and exit immediately if the version does not support the sidecar feature.
    -   Consider a runtime feature detection design:
        -   Define an empty dir so containers can communicate with each other
        -   Inject an init container, let's call it `NativeSidecar` with `restartPolicy=Always`.
        -   `NativeSidecar` must write a file to an empty directory indicating the first run and exit immediately with exit code `0`.
        -   `NativeSidecar` on restart (when native sidecars are supported) checks that file already exists in the empty dir and changes it - indicating that the built-in sidecar containers are supported and running.
        -   Inject regular container, let's call it `OldWaySidecar`.
        -   `OldWaySidecar` on start checks the presence of a file in an empty dir.
        -   If the file indicates that the `NativeSidecar` is NOT running, it assumes that the sidecar feature is not supported and works assuming it is the sidecar.
        -   If the file indicates that the `NativeSidecar` is running, it either does nothing and sleeps forever (in the case when Pod’s `restartPolicy=Always`) or exits immediately with exit code `0` (in the case when Pod’s `restartPolicy!=Always`).

## What's next

-   Learn more about [sidecar containers](/docs/concepts/workloads/pods/sidecar-containers/).
