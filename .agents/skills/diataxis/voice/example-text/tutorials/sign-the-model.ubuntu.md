---
type: tutorial
source: https://documentation.ubuntu.com/core/tutorials/build-your-first-image/sign-the-model/
title: Sign the model
domain: ubuntu
---

# Sign the model

After a model has been created or modified, it must be signed with a GPG key to become a _model assertion_. This ensures the model cannot be altered without the key and also links the created image to both the signed version of the model and your Ubuntu One account.

## Create a key

First make sure there are no keys already associated with your account by running the `snapcraft keys` command (you will only have a key if you've previously signed an assertion; if you already have a key, you can use that one):

```bash
$ snapcraft keys
No keys have been registered. See 'snapcraft register-key --help' to register a key.
```

Now use `snapcraft` to create a key called **my-model-key** (the name is arbitrary):

```bash
$ snapcraft create-key my-model-key
Passphrase: <passphrase>
Confirm passphrase: <passphrase>
```

As shown above, you will be asked for a passphrase. You need to remember this as you'll be prompted to enter it whenever you use the key, including the very next step.

## Register the key

We now need to upload the key and register it with your Ubuntu One account. This is accomplished with register-key:

```bash
$ snapcraft register-key my-model-key
Enter your Ubuntu One e-mail address and password.
If you do not have an Ubuntu One account, you can create one at https://snapcraft.io/account
Email: <Ubuntu-SSO-email-address>
Password: <Ubuntu-SSO-password>

Registering key ...
Done. The key "my-model-key" (<key fingerprint>) may be used to sign your assertions.
```

Regardless of whether you're logged in with snapcraft, you will be asked for your account and password details. You'll also need to unlock the key with your passphrase, and when the process is complete, the `snapcraft keys` command will now list the registered key:

```bash
$ snapcraft keys
    Name          SHA3-384 fingerprint
*   my-model-key  <key fingerprint>
```

### Update the timestamp

As mentioned earlier, the timestamp in the model assertion must be set to a time and date _after_ the creation of our key. This means we need to edit `my-model.json` to update the timestamp with the current time.

```json
    "timestamp": "2026-05-07T10:40:41+00:00",
```

This is a UTC-formatted time and date value, used to denote the assertion's creation time. It needs to be replaced with the current time and date, which can be generated with the following command:

```bash
$ date -Iseconds --utc
2026-05-07T09:29:09+00:00
```

## Sign the model

A model assertion is created by feeding the JSON file into the `snap sign` command with your recently-created key name and capturing the output in the corresponding model file:

```bash
snap sign -k my-model-key my-model.json > my-model.model
```

You will again be asked for your key's passphrase.

The resultant `my-model.model` file contains the signed model assertion and can now be used to build the image.
