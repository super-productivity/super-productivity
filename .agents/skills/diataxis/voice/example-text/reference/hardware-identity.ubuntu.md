---
type: reference
source: https://documentation.ubuntu.com/core/reference/assertions/hardware-identity/
title: hardware-identity
domain: ubuntu
---

# hardware-identity

The _hardware-identity_ assertion binds a device to its unique hardware identity public key.

Ubuntu Core and SnapD support Secure Device Registration to ensure that only authorised devices can obtain a serial assertion. During manufacturing, each device is provisioned with a unique key pair that remains unchanged throughout its lifecycle, serving as its root identity.

The hardware-identity assertion contains the public portion of this key and is issued with the device. When presented to the Model Service, it allows the service to verify that a serial assertion request genuinely originates from that device.

Unlike the serial assertion, the hardware-identity assertion can be shared with the Model Service before registration and is only used to confirm the device's unique identity. It is not required after registration is complete.

The exact cryptographic implementation for Secure Registration may vary depending on the device's hardware and software capabilities. Details are described in the [gadget snap](/reference/gadget-snap-format) documentation.

## Fields

The following fields can be used in a hardware-identity assertion:

```yaml
type:                     hardware-identity
authority-id:             <authority account id>
issuer-id:                <issuer-id>
manufacturer:             <manufacturer>
hardware-name:            <hardware-name>
hardware-id:              <hardware-id for the device>
hardware-id-key:          <public key and type>
hardware-id-key-sha3-384: <digest of the device key>
timestamp:                <UTC datetime>
sign-key-sha3-384:        <key id> # Encoded key id of signing key

<signature>                 # Encoded signature
```

The index is the tuple \<`issuer-id', `hardware-id-key-sha3-384`\>.

This assertion must be signed by the issuer. See [Assertion format](/reference/assertions/index) for more details on fields common to most assertions.
