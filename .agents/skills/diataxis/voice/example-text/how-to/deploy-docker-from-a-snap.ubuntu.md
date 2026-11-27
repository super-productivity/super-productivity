---
type: how-to
source: https://documentation.ubuntu.com/core/how-to-guides/container-deployment/deploy-docker-from-a-snap/
title: Deploy Docker from a snap
domain: ubuntu
---

# Deploy Docker from a snap

As with any other snap-enabled environment, Ubuntu Core can install and deploy _Docker containers_ from the command line, first by installing the [Docker container runtime](https://snapcraft.io/docker) snap, and then running either `docker run` or `docker compose`. This approach is useful for testing, but it's difficult to scale.

Ubuntu Core has been designed to boot into a production state without manual interaction. This is accomplished by building a custom Ubuntu Core image for your specific application and device deployment.

To build such an image to deploy Docker with your own configuration requires the creation a companion snap, the creation of which is described in this _How-to_. Our example will deploy [RabbitMQ](https://www.rabbitmq.com/), an industry-grade message broker implementing protocols such as AMQP and MQTT, but it can easily be adapted to deploy any other Docker application.

Basic familiarity with snaps isn't required but paves the way for a smooth experience. We suggest going though the [tutorial on creating a snap](https://snapcraft.io/docs/create-a-new-snap) or another similar guide.

## Create the snap

Start by initializing a snap project in a clean directory:

```shell
snapcraft init
```

Now, we need to add some scripts to implement the container management operations.

Create a script at `snap/local/bin/run.sh` with the following content:

```bash
#!/bin/bash -eu

container_name="$SNAP_INSTANCE_NAME"
image_name="rabbitmq:$DOCKER_IMAGE_TAG"

if [ ! "$(docker ps --all --quiet --filter name="$container_name")" ]; then
    echo "Container does not exist. Creating ..."
    docker create \
        --name "$container_name" \
        --publish 5672:5672 \
        --publish 15672:15672 \
        --log-driver none \
        "$image_name"
fi

echo "Starting container ..."
docker start --attach "$container_name"
```

Then, make it executable: `chmod +x snap/local/bin/run.sh`.

This script is responsible for (creating and) starting the Docker container.

It is important to disable the log driver (by setting it to `none`) so that we don't store the logs twice. Docker Engine uses the [`json-file`](https://docs.docker.com/config/containers/logging/configure/) driver by default. Snaps write logs to Journal.
With the given configuration, the service's standard output will be written to Journal only.

## Install the snap

```shell
sudo snap install --dangerous ./rabbitmq-docker-guide_demo_amd64.snap
```

The [`--dangerous`](https://snapcraft.io/docs/install-modes#dangerous-mode) flag is set because this is a locally built, unsigned snap.

Connect the following [interfacess](https://snapcraft.io/docs/interfaces):

```shell
# For access to Docker Daemon
sudo snap connect rabbitmq-docker-guide:docker docker:docker-daemon
# For access to Docker CLI
sudo snap connect rabbitmq-docker-guide:docker-executables docker:docker-executables
```

Start the service:

```shell
sudo snap start rabbitmq-docker-guide
```

Verify that everything is working and setup correctly by looking into the following:

- Snap logs: `snap logs -n 100 rabbitmq-docker-guide`
- Docker containers: `docker ps`

You should be able to access the RabbitMQ's management dashboard via a web browser.
By default, it is available at `http://localhost:15672` (username/password: `guest`).

## Next steps

In this guide, we created a RabbitMQ companion snap that made it possible to deploy, configure, and maintain the RabbitMQ Docker image on Ubuntu Core.

The companion snap can be extended to take care of many other requirements including:

- Shipping the Docker image inside the snap for better reproducibility and deployment in air-gapped environments.
- Pruning dangling images to save disk space after upgrades
- Using Docker compose; although this isn't recommended because it will encapsulate several containers into a single service

Apart from installing the snap, we performed a few manual operations on target such as for interface connections and setting snap configuration options. This went against our initial goal of deploying the application without manual interaction. Ubuntu Core leverages other tools and services to automate such operations. These include Ubuntu Core image creation with custom snaps, [gadget snaps](https://snapcraft.io/docs/the-gadget-snap) for adding default configurations and connections into the image, and dedicated snap stores with deployment-specific interface auto-connection assertions.

The created snap and its future revisions can be published to a snap store to allow remote deployment and OTA updates of the Docker container.
