---
type: how-to
source: https://kubernetes.io/docs/tasks/batch/coarse-parallel-processing-work-queue/
title: Coarse Parallel Processing Using a Work Queue
domain: kubernetes
---

# Coarse Parallel Processing Using a Work Queue

In this example, you will run a Kubernetes Job with multiple parallel worker processes.

In this example, as each pod is created, it picks up one unit of work from a task queue, completes it, deletes it from the queue, and exits.

Here is an overview of the steps in this example:

1.  **Start a message queue service.** In this example, you use RabbitMQ, but you could use another one. In practice you would set up a message queue service once and reuse it for many jobs.
2.  **Create a queue, and fill it with messages.** Each message represents one task to be done. In this example, a message is an integer that we will do a lengthy computation on.
3.  **Start a Job that works on tasks from the queue**. The Job starts several pods. Each pod takes one task from the message queue, processes it, and exits.

## Before you begin

You should already be familiar with the basic, non-parallel, use of [Job](/docs/concepts/workloads/controllers/job/).

You need to have a Kubernetes cluster, and the kubectl command-line tool must be configured to communicate with your cluster. It is recommended to run this tutorial on a cluster with at least two nodes that are not acting as control plane hosts. If you do not already have a cluster, you can create one by using [minikube](https://minikube.sigs.k8s.io/docs/tutorials/multi_node/) or you can use one of these Kubernetes playgrounds:

-   [iximiuz Labs](https://labs.iximiuz.com/playgrounds?category=kubernetes&filter=all)
-   [Killercoda](https://killercoda.com/playgrounds/scenario/kubernetes)
-   [KodeKloud](https://kodekloud.com/public-playgrounds)

You will need a container image registry where you can upload images to run in your cluster.

This task example also assumes that you have Docker installed locally.

## Starting a message queue service

This example uses RabbitMQ, however, you can adapt the example to use another AMQP-type message service.

In practice you could set up a message queue service once in a cluster and reuse it for many jobs, as well as for long-running services.

Start RabbitMQ as follows:

```shell
# make a Service for the StatefulSet to use
kubectl create -f https://kubernetes.io/examples/application/job/rabbitmq/rabbitmq-service.yaml
```

```
service "rabbitmq-service" created
```

```shell
kubectl create -f https://kubernetes.io/examples/application/job/rabbitmq/rabbitmq-statefulset.yaml
```

```
statefulset "rabbitmq" created
```

## Testing the message queue service

Now, we can experiment with accessing the message queue. We will create a temporary interactive pod, install some tools on it, and experiment with queues.

First create a temporary interactive Pod.

```shell
# Create a temporary interactive container
kubectl run -i --tty temp --image ubuntu:22.04
```

```
Waiting for pod default/temp-loe07 to be running, status is Pending, pod ready: false
... [ previous line repeats several times .. hit return when it stops ] ...
```

Note that your pod name and command prompt will be different.

Next install the `amqp-tools` so you can work with message queues. The next commands show what you need to run inside the interactive shell in that Pod:

```shell
apt-get update && apt-get install -y curl ca-certificates amqp-tools python3 dnsutils
```

Later, you will make a container image that includes these packages.

Next, you will check that you can discover the Service for RabbitMQ:

```
# Run these commands inside the Pod
# Note the rabbitmq-service has a DNS name, provided by Kubernetes:
nslookup rabbitmq-service
```

```
Server:        10.0.0.10
Address:    10.0.0.10#53

Name:    rabbitmq-service.default.svc.cluster.local
Address: 10.0.147.152
```

(the IP addresses will vary)

If the cluster DNS addon is not set up correctly, the previous step may not work for you. You can also find the IP address for that Service in an environment variable:

```shell
# run this check inside the Pod
env | grep RABBITMQ_SERVICE | grep HOST
```

```
RABBITMQ_SERVICE_SERVICE_HOST=10.0.147.152
```

(the IP address will vary)

Next you will verify that you can create a queue, and publish and consume messages.

```shell
# Run these commands inside the Pod
# In the next line, rabbitmq-service is the hostname where the rabbitmq-service
# can be reached.  5672 is the standard port for rabbitmq.
export BROKER_URL=amqp://guest:guest@rabbitmq-service:5672
# If you could not resolve "rabbitmq-service" in the previous step,
# then use this command instead:
BROKER_URL=amqp://guest:guest@$RABBITMQ_SERVICE_SERVICE_HOST:5672

# Now create a queue:

/usr/bin/amqp-declare-queue --url=$BROKER_URL -q foo -d
```

```
foo
```

Publish one message to the queue:

```shell
/usr/bin/amqp-publish --url=$BROKER_URL -r foo -p -b Hello

# And get it back.

/usr/bin/amqp-consume --url=$BROKER_URL -q foo -c 1 cat && echo 1>&2
```

```
Hello
```

In the last command, the `amqp-consume` tool took one message (`-c 1`) from the queue, and passes that message to the standard input of an arbitrary command. In this case, the program `cat` prints out the characters read from standard input, and the echo adds a carriage return so the example is readable.

## Fill the queue with tasks

Now, fill the queue with some simulated tasks. In this example, the tasks are strings to be printed.

In a practice, the content of the messages might be:

-   names of files to that need to be processed
-   extra flags to the program
-   ranges of keys in a database table
-   configuration parameters to a simulation
-   frame numbers of a scene to be rendered

If there is large data that is needed in a read-only mode by all pods of the Job, you typically put that in a shared file system like NFS and mount that readonly on all the pods, or write the program in the pod so that it can natively read data from a cluster file system (for example: HDFS).

For this example, you will create the queue and fill it using the AMQP command line tools. In practice, you might write a program to fill the queue using an AMQP client library.

```shell
# Run this on your computer, not in the Pod
/usr/bin/amqp-declare-queue --url=$BROKER_URL -q job1  -d
```

```
job1
```

Add items to the queue:

```shell
for f in apple banana cherry date fig grape lemon melon
do
  /usr/bin/amqp-publish --url=$BROKER_URL -r job1 -p -b $f
done
```

You added 8 messages to the queue.

## Create a container image

Now you are ready to create an image that you will run as a Job.

The job will use the `amqp-consume` utility to read the message from the queue and run the actual work. Here is a very simple example program:

[`application/job/rabbitmq/worker.py`](https://raw.githubusercontent.com/kubernetes/website/main/content/en/examples/application/job/rabbitmq/worker.py) ![](/images/copycode.svg "Copy application/job/rabbitmq/worker.py to clipboard")

```python
#!/usr/bin/env python

# Just prints standard out and sleeps for 10 seconds.
import sys
import time
print("Processing " + sys.stdin.readlines()[0])
time.sleep(10)
```

Give the script execution permission:

```shell
chmod +x worker.py
```

Now, build an image. Make a temporary directory, change to it, download the [Dockerfile](/examples/application/job/rabbitmq/Dockerfile), and [worker.py](/examples/application/job/rabbitmq/worker.py). In either case, build the image with this command:

```shell
docker build -t job-wq-1 .
```

For the [Docker Hub](https://hub.docker.com/), tag your app image with your username and push to the Hub with the below commands. Replace `<username>` with your Hub username.

```shell
docker tag job-wq-1 <username>/job-wq-1
docker push <username>/job-wq-1
```

If you are using an alternative container image registry, tag the image and push it there instead.

## Defining a Job

Here is a manifest for a Job. You'll need to make a copy of the Job manifest (call it `./job.yaml`), and edit the name of the container image to match the name you used.

[`application/job/rabbitmq/job.yaml`](https://raw.githubusercontent.com/kubernetes/website/main/content/en/examples/application/job/rabbitmq/job.yaml) ![](/images/copycode.svg "Copy application/job/rabbitmq/job.yaml to clipboard")

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: job-wq-1
spec:
  completions: 8
  parallelism: 2
  template:
    metadata:
      name: job-wq-1
    spec:
      containers:
      - name: c
        image: gcr.io/<project>/job-wq-1
        env:
        - name: BROKER_URL
          value: amqp://guest:guest@rabbitmq-service:5672
        - name: QUEUE
          value: job1
      restartPolicy: OnFailure
```

In this example, each pod works on one item from the queue and then exits. So, the completion count of the Job corresponds to the number of work items done. That is why the example manifest has `.spec.completions` set to `8`.

## Running the Job

Now, run the Job:

```shell
# this assumes you downloaded and then edited the manifest already
kubectl apply -f ./job.yaml
```

You can wait for the Job to succeed, with a timeout:

```shell
# The check for condition name is case insensitive
kubectl wait --for=condition=complete --timeout=300s job/job-wq-1
```

Next, check on the Job:

```shell
kubectl describe jobs/job-wq-1
```

```
Name:             job-wq-1
Namespace:        default
Selector:         controller-uid=41d75705-92df-11e7-b85e-fa163ee3c11f
Labels:           controller-uid=41d75705-92df-11e7-b85e-fa163ee3c11f
                  job-name=job-wq-1
Annotations:      <none>
Parallelism:      2
Completions:      8
Start Time:       Wed, 06 Sep 2022 16:42:02 +0000
Pods Statuses:    0 Running / 8 Succeeded / 0 Failed
Pod Template:
  Labels:       controller-uid=41d75705-92df-11e7-b85e-fa163ee3c11f
                job-name=job-wq-1
  Containers:
   c:
    Image:      container-registry.example/causal-jigsaw-637/job-wq-1
    Port:
    Environment:
      BROKER_URL:       amqp://guest:guest@rabbitmq-service:5672
      QUEUE:            job1
    Mounts:             <none>
  Volumes:              <none>
Events:
  FirstSeen  LastSeen   Count    From    SubobjectPath    Type      Reason              Message
  ─────────  ────────   ─────    ────    ─────────────    ──────    ──────              ───────
  27s        27s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-hcobb
  27s        27s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-weytj
  27s        27s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-qaam5
  27s        27s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-b67sr
  26s        26s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-xe5hj
  15s        15s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-w2zqe
  14s        14s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-d6ppa
  14s        14s        1        {job }                   Normal    SuccessfulCreate    Created pod: job-wq-1-p17e0
```

All the pods for that Job succeeded! You're done.

## Alternatives

This approach has the advantage that you do not need to modify your "worker" program to be aware that there is a work queue. You can include the worker program unmodified in your container image.

Using this approach does require that you run a message queue service. If running a queue service is inconvenient, you may want to consider one of the other [job patterns](/docs/concepts/workloads/controllers/job/#job-patterns).

This approach creates a pod for every work item. If your work items only take a few seconds, though, creating a Pod for every work item may add a lot of overhead. Consider another design, such as in the [fine parallel work queue example](/docs/tasks/job/fine-parallel-processing-work-queue/), that executes multiple work items per Pod.

In this example, you used the `amqp-consume` utility to read the message from the queue and run the actual program. This has the advantage that you do not need to modify your program to be aware of the queue. The [fine parallel work queue example](/docs/tasks/job/fine-parallel-processing-work-queue/) shows how to communicate with the work queue using a client library.

## Caveats

If the number of completions is set to less than the number of items in the queue, then not all items will be processed.

If the number of completions is set to more than the number of items in the queue, then the Job will not appear to be completed, even though all items in the queue have been processed. It will start additional pods which will block waiting for a message. You would need to make your own mechanism to spot when there is work to do and measure the size of the queue, setting the number of completions to match.

There is an unlikely race with this pattern. If the container is killed in between the time that the message is acknowledged by the `amqp-consume` command and the time that the container exits with success, or if the node crashes before the kubelet is able to post the success of the pod back to the API server, then the Job will not appear to be complete, even though all items in the queue have been processed.
