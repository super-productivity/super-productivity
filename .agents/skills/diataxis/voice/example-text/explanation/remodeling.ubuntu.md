---
type: explanation
source: https://documentation.ubuntu.com/core/explanation/remodeling/
title: Remodeling
domain: ubuntu
---

# Remodeling

The set of snaps that make up a device, and govern its capabilities, are controlled by the model assertion, alongside the snap assertions in a given recovery system.

The model assertion contains:

- Identification information, such as brand account id and model name.
- Which essential snaps make up the device system, including the gadget snap, kernel snap and the boot base snap with the root filesystem.
- Other required or optional snaps that implement the device functionality.
- Additional options for the defined device, such as grade, and the store it is connected to.

The snaps declared in the model assertion can be updated during the device lifecycle. However, when the system must be upgraded, or when one or more of the above elements change, a new model assertion can be deployed to the device. The updated model assertion is authenticated and linked through its serial assertion to the store. The image is upgraded based on the delta compared to the previous model. This process is called remodeling.

## Remodeling viability

After a model assertion has been updated, the remodeling process is triggered from either the snapd's REST API, or by running the `snap remodel` command.

Remodeling can never downgrade the system's base snap. For example, remodeling from `core22` to `core20` is not supported.

```bash
sudo snap remodel <new-model.assert>
```

Both methods need an updated model assertion as input. Its `revision` field must be incremented, and it must be signed using a key registered to the same brand that signed the original model. If it differs from the key used to sign the original model, an account-key assertion must be registered on the device before proceeding with the remodeling.

```bash
snap known account-key --remote public-key-sha3-384=<digest> > key.assert
snap ack key.assert
```

Remodeling triggers the generation of a new recovery system, which means care needs to be taken to ensure the ubuntu-seed partition is sized accordingly. The process also ensures the newly created recovery system is valid. Therefore, the previous recovery system can be safely removed after remodeling has completed.

Remodeling is the responsibility of the snap daemon (_snapd_) running on the device. It both mediates the update process and the re-registration of the device after the update (if required). But the complexity and viability of the remodeling process is dependent on several factors outside of snapd's control.

At its simplest, a device can be successfully remodeled when using the same model name and the same dedicated Snap Store but with a new model revision where the only difference is an added or removed snap, or changed snap track or channel. The device also needs to have a Serial assertion.

But if the dedicated Snap Store needs to change, even under the same brand scope, this requires the acquisition of a new serial assertion, and the success or failure of such a process will depend on the context.

With a dedicated Snap Store, the following types of remodeling contexts are possible:

- **same brand/model -> same dedicated Snap Store**
  Works as a simple contextual carrier for the new model.
- **same brand/model -> different dedicated Snap Store**
  Keeps access to the device state kept on the remodel change, creates a store that uses that state, and then refers to the new dedicated Snap Store. Requires a new serial in the Model Service or the Serial Vault and the creation of a new Serial assertion.

## Compatibility

The below permutations of the remodeling contexts are all valid:

| brand | store     | model name | + snaps | - snaps |
| ----- | --------- | ---------- | ------- | ------- |
| same  | same      | same       | yes     | yes     |
| same  | same      | different  | yes     | yes     |
| same  | different | same       | yes     | yes     |
| same  | different | different  | yes     | yes     |

If a validation set has been defined for the old model and the new model, or just the new model, the snaps installed during the remodeling process must follow the validation set rules.

## Snap removal

The remodeling process does not automatically remove snaps which are no longer marked as `required` or `optional` in the new model assertion. Those snaps stay in the system and keep receiving updates, but since they are no longer required by the model, it is possible to remove them.

The general practice is that either the operator who invoked `snap remodel` command, or the management agent which started the remodel process, is responsible for requesting removal of said snaps. If snap data is no longer needed, the remove request should include the `purge` option to remove all data associated with the removed snap.
