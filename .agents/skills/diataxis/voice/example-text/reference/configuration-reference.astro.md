---
type: reference
source: https://docs.astro.build/en/reference/configuration-reference/
title: Configuration Reference
domain: astro
---

The following reference covers all supported configuration options in Astro. To learn more about configuring Astro, read our guide on [Configuring Astro](/en/guides/configuring-astro/).

astro.config.mjs


    import { defineConfig } from 'astro/config'


    export default defineConfig({

      // your configuration options here...

    })

## Top-Level Options


### site


**Type:** `string`

Your final, deployed URL. Astro uses this full URL to generate your sitemap and canonical URLs in your final build. It is strongly recommended that you set this configuration to get the most out of Astro.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      site: 'https://www.my-site.dev'

    });

### base


**Type:** `string`

The base path to deploy to. Astro will use this path as the root for your pages and assets both in development and in production build.

In the example below, `astro dev` will start your server at `/docs`.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      base: '/docs'

    });

When using this option, all of your static asset imports and URLs should add the base as a prefix. You can access this value via `import.meta.env.BASE_URL`.

The value of `import.meta.env.BASE_URL` will be determined by your `trailingSlash` config, no matter what value you have set for `base`.

A trailing slash is always included if `trailingSlash: "always"` is set. If `trailingSlash: "never"` is set, `BASE_URL` will not include a trailing slash, even if `base` includes one.

Additionally, Astro will internally manipulate the configured value of `config.base` before making it available to integrations. The value of `config.base` as read by integrations will also be determined by your `trailingSlash` configuration in the same way.

In the example below, the values of `import.meta.env.BASE_URL` and `config.base` when processed will both be `/docs`:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      base: '/docs/',

      trailingSlash: "never"

    });

In the example below, the values of `import.meta.env.BASE_URL` and `config.base` when processed will both be `/docs/`:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      base: '/docs',

      trailingSlash: "always"

    });

### trailingSlash


**Type:** `'always' | 'never' | 'ignore'`
**Default:** `'ignore'`

Set the route matching behavior for trailing slashes in the dev server and on-demand rendered pages. Choose from the following options:

  * `'ignore'` \- Match URLs regardless of whether a trailing “/” exists. Requests for “/about” and “/about/” will both match the same route.
  * `'always'` \- Only match URLs that include a trailing slash (e.g: “/about/”). In production, requests for on-demand rendered URLs without a trailing slash will be redirected to the correct URL for your convenience. However, in development, they will display a warning page reminding you that you have `always` configured.
  * `'never'` \- Only match URLs that do not include a trailing slash (e.g: “/about”). In production, requests for on-demand rendered URLs with a trailing slash will be redirected to the correct URL for your convenience. However, in development, they will display a warning page reminding you that you have `never` configured.


When redirects occur in production for GET requests, the redirect will be a 301 (permanent) redirect. For all other request methods, it will be a 308 (permanent, and preserve the request method) redirect.

Trailing slashes on prerendered pages are handled by the hosting platform, and may not respect your chosen configuration. See your hosting platform’s documentation for more information. You cannot use Astro redirects for this use case at this point.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      // Example: Require a trailing slash during development

      trailingSlash: 'always'

    });

**See Also:**

  * build.format


### redirects


**Type:** `Record<string, RedirectConfig>`
**Default:** `{}`


**Added in:** `astro@2.9.0`

Specify a mapping of redirects where the key is the route to match and the value is the path to redirect to.

You can redirect both static and dynamic routes, but only to the same kind of route. For example, you cannot have a `'/article': '/blog/[...slug]'` redirect.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      redirects: {

       '/old': '/new',

       '/blog/[...slug]': '/articles/[...slug]',

       '/about': 'https://example.com/about',

       '/news': {

         status: 302,

         destination: 'https://example.com/news'

       },

       // '/product1/', '/product1' // Note, this is not supported

      }

    });

For statically-generated sites with no adapter installed, this will produce a client redirect using a [`<meta http-equiv="refresh">` tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#http-equiv) and does not support status codes.

When using SSR or with a static adapter in `output: static` mode, status codes are supported. Astro will serve redirected GET requests with a status of `301` and use a status of `308` for any other request method.

You can customize the [redirection status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#redirection_messages) using an object in the redirect config:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      redirects: {

        '/other': {

          status: 302,

          destination: '/place',

        },

      }

    });

### output


**Type:** `'static' | 'server'`
**Default:** `'static'`

Specifies the output target for builds.

  * `'static'` \- Prerender all your pages by default, outputting a completely static site if none of your pages opt out of prerendering.
  * `'server'` \- Use server-side rendering (SSR) for all pages by default, always outputting a server-rendered site.


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      output: 'static'

    });

**See Also:**

  * adapter


### adapter


**Type:** `AstroIntegration`

Deploy to your favorite server, serverless, or edge host with build adapters. Import one of our first-party adapters ([Cloudflare](/en/guides/integrations-guide/cloudflare/), [Netlify](/en/guides/integrations-guide/netlify/), [Node.js](/en/guides/integrations-guide/node/), [Vercel](/en/guides/integrations-guide/vercel/)) or explore [community adapters](https://astro.build/integrations/2/?search=&categories%5B%5D=adapters) to enable on-demand rendering in your Astro project.

See our [on-demand rendering guide](/en/guides/on-demand-rendering/) for more on Astro’s server rendering options.

astro.config.mjs


    import { defineConfig } from 'astro/config';

    import netlify from '@astrojs/netlify';


    export default defineConfig({

      // Example: Build for Netlify serverless deployment

      adapter: netlify(),

    });

**See Also:**

  * output


### integrations


**Type:** `AstroIntegration[]`

Extend Astro with custom integrations. Integrations are your one-stop-shop for adding framework support (like Solid.js), new features (like sitemaps), and new libraries (like Partytown).

Read our [Integrations Guide](/en/guides/integrations/) for help getting started with Astro Integrations.

astro.config.mjs


    import { defineConfig } from 'astro/config';

    import react from '@astrojs/react';

    import mdx from '@astrojs/mdx';


    export default defineConfig({

      // Example: Add React + MDX support to Astro

      integrations: [react(), mdx()]

    });

### root


**Type:** `string`
**CLI:** `--root`
**Default:** `"."` (current working directory)

You should only provide this option if you run the `astro` CLI commands in a directory other than the project root directory. Usually, this option is provided via the CLI instead of the Astro config file, since Astro needs to know your project root before it can locate your config file.

If you provide a relative path (ex: `--root: './my-project'`) Astro will resolve it against your current working directory.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      root: './my-project-directory'

    });

The following example sets the root directory using the CLI:

Terminal window


    astro build --root ./my-project-directory

### srcDir


**Type:** `string`
**Default:** `"./src"`

Set the directory that Astro will read your site from.

The value can be either an absolute file system path or a path relative to the project root.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      srcDir: './www'

    });

### publicDir


**Type:** `string`
**Default:** `"./public"`

Set the directory for your static assets. Files in this directory are served at `/` during dev and copied to your build directory during build. These files are always served or copied as-is, without transform or bundling.

The value can be either an absolute file system path or a path relative to the project root.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      publicDir: './my-custom-publicDir-directory'

    });

### outDir


**Type:** `string`
**Default:** `"./dist"`

Set the directory that `astro build` writes your final build to.

The value can be either an absolute file system path or a path relative to the project root.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      outDir: './my-custom-build-directory'

    });

**See Also:**

  * build.server


### cacheDir


**Type:** `string`
**Default:** `"./node_modules/.astro"`

Set the directory for caching build artifacts. Files in this directory will be used in subsequent builds to speed up the build time.

The value can be either an absolute file system path or a path relative to the project root.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      cacheDir: './my-custom-cache-directory'

    });

### compressHTML


**Type:** `boolean | "jsx"`
**Default:** `'jsx'`

Controls how Astro handles whitespace in your HTML. This affects both development mode and the final build output.

Since v7.0, Astro applies by default the JSX whitespace rules used by frameworks like React. This removes whitespace and line breaks around elements, collapses multi-line text onto a single line, and preserves whitespace within a single line (e.g. a space between two inline elements). To keep a space that would otherwise be removed, include it explicitly in the source through constructs such as `{" "}`.

Setting this option to `true` instead removes whitespace, including line breaks, in a lossless manner from `.astro` components. Some whitespace may be preserved as needed to maintain the visual rendering of your HTML.

Setting this option to `false` disables HTML compression and preserves all whitespace.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      compressHTML: true

      // or:

      // compressHTML: false

    });

### scopedStyleStrategy


**Type:** `'where' | 'class' | 'attribute'`
**Default:** `'attribute'`


**Added in:** `astro@2.4`

Specify the strategy used for scoping styles within Astro components. Choose from:

  * `'where'` \- Use `:where` selectors, causing no specificity increase.
  * `'class'` \- Use class-based selectors, causing a +1 specificity increase.
  * `'attribute'` \- Use `data-` attributes, causing a +1 specificity increase.


Using `'class'` is helpful when you want to ensure that element selectors within an Astro component override global style defaults (e.g. from a global stylesheet). Using `'where'` gives you more control over specificity, but requires that you use higher-specificity selectors, layers, and other tools to control which selectors are applied. Using `'attribute'` is useful when you are manipulating the `class` attribute of elements and need to avoid conflicts between your own styling logic and Astro’s application of styles.

### prerenderConflictBehavior


**Type:** `'error' | 'warn' | 'ignore'`
**Default:** `'warn'`


**Added in:** `astro@6.0`

Determines the default behavior when two routes generate the same prerendered URL:

  * `error`: fail the build and display an error, forcing you to resolve the conflict
  * `warn` (default): log a warning when conflicts occur, but build using the highest-priority route
  * `ignore`: silently build using the highest-priority route when conflicts occur


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      prerenderConflictBehavior: 'error'

    });

### vite


**Type:** `ViteUserConfig`

Pass additional configuration options to Vite. Useful when Astro doesn’t support some advanced configuration that you may need.

View the full `vite` configuration object documentation on [vite.dev](https://vite.dev/config/).

#### Examples


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      vite: {

        ssr: {

          // Example: Force a broken package to skip SSR processing, if needed

          external: ['broken-npm-package'],

        }

      }

    });

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      vite: {

        // Example: Add custom vite plugins directly to your Astro project

        plugins: [myPlugin()],

      }

    });

### security


**Type:** `Record<"checkOrigin", boolean> | undefined`
**Default:** `{checkOrigin: true}`


**Added in:** `astro@4.9.0`

Enables security measures for an Astro website.

These features only exist for pages rendered on demand (SSR) using `server` mode or pages that opt out of prerendering in `static` mode.

By default, Astro checks browser request metadata to ensure that form submissions to on-demand rendered pages come from the same origin. To disable this behavior set `checkOrigin` to `false`:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      output: "server",

      security: {

        checkOrigin: false

      }

    });

#### security.checkOrigin


**Type:** `boolean`
**Default:** `true`


**Added in:** `astro@4.9.0`

Provides [Cross-Site Request Forgery (CSRF)](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF) protection by checking the header sent by browsers against the `Request` URL. This uses the `Sec-Fetch-Site` header for modern browsers and falls back to the `Origin` header when unavailable.

The check is executed only for pages rendered on demand, and only for unsafe requests such as `POST`, `PATCH`, `DELETE`, and `PUT` with no `content-type` header or one of the following values: `'application/x-www-form-urlencoded'`, `'multipart/form-data'`, `'text/plain'`.

If the request is identified as cross-origin, Astro will return a 403 status code and will not render the page.

#### security.allowedDomains


**Type:** `Array<RemotePattern>`
**Default:** `[]`


**Added in:** `astro@5.14.2`

Defines a list of permitted host patterns for incoming requests when using SSR. When configured, Astro will validate the `X-Forwarded-Host` header against these patterns for security. If the header doesn’t match any allowed pattern, the header is ignored and the request’s original host is used instead.

This prevents host header injection attacks where malicious actors can manipulate the `Astro.url` value by sending crafted `X-Forwarded-Host` headers.

Each pattern can specify `protocol`, `hostname`, and `port`. All three are validated if provided. The patterns support wildcards for flexible hostname matching:

  * `*.example.com` \- matches exactly one subdomain level (e.g., `sub.example.com` but not `deep.sub.example.com`)
  * `**.example.com` \- matches any subdomain depth (e.g., both `sub.example.com` and `deep.sub.example.com`)


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        // Example: Allow any subdomain of example.com on https

        allowedDomains: [

          {

            hostname: '**.example.com',

            protocol: 'https'

          },

          {

            hostname: 'staging.myapp.com',

            protocol: 'https',

            port: '443'

          }

        ]

      }

    });

In some specific contexts (e.g., applications behind trusted reverse proxies with dynamic domains), you may need to allow all domains. To do this, use an empty object:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        // Allow any domain - use this only when necessary

        allowedDomains: [{}]

      }

    });

When not configured, `X-Forwarded-Host` headers are not trusted and will be ignored.

#### security.actionBodySizeLimit


**Type:** `number`
**Default:** `1048576` (1 MB)


**Added in:** `astro@5.18.0`

Sets the maximum size in bytes allowed for action request bodies.

By default, action request bodies are limited to 1 MB (1048576 bytes) to prevent abuse. You can increase this limit if your actions need to accept larger payloads, for example when handling file uploads.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        actionBodySizeLimit: 10 * 1024 * 1024 // 10 MB

      }

    });

#### security.serverIslandBodySizeLimit


**Type:** `number`
**Default:** `1048576` (1 MB)


**Added in:** `astro@6.0.0`

Sets the maximum size in bytes allowed for server island request bodies, which contain the encrypted props and slot HTML passed to the island component.

By default, server island request bodies are limited to 1 MB (1048576 bytes) to prevent abuse. You can increase this limit if your server islands need to accept larger payloads.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        serverIslandBodySizeLimit: 10 * 1024 * 1024 // 10 MB

      }

    });

#### security.csp


**Type:** `boolean | object`
**Default:** `false`


**Added in:** `astro@6.0.0`

Enables support for [Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) to help minimize certain types of security threats by controlling which resources a document is allowed to load. This provides additional protection against [cross-site scripting (XSS)](https://developer.mozilla.org/en-US/docs/Glossary/Cross-site_scripting) attacks.

Enabling this feature adds additional security to Astro’s handling of processed and bundled scripts and styles by default, and allows you to further configure these, and additional, content types.

This feature comes with some limitations:

  * External scripts and external styles are not supported out of the box, but you can provide your own hashes.
  * [Astro’s view transitions](/en/guides/view-transitions/) using the `<ClientRouter />` are not supported, but you can [consider migrating to the browser native View Transition API](https://events-3bg.pages.dev/jotter/astro-view-transitions/) instead if you are not using Astro’s enhancements to the native View Transitions and Navigation APIs.
  * Shiki isn’t currently supported. By design, Shiki functions use inline styles that cannot work with Astro CSP implementation. Consider [using `<Prism />`](/en/guides/syntax-highlighting/#prism-) when your project requires both CSP and syntax highlighting.
  * When `'unsafe-inline'` is included as a resource in a directive, Astro will not emit hashes on that directive. Per the CSP spec, browsers ignore `'unsafe-inline'` when a hash or nonce is present in the same directive, so Astro suppresses hashes to preserve `'unsafe-inline'` behavior. Note that this reduces the security of that directive to the level of `'unsafe-inline'`.


When enabled, Astro will add a `<meta>` element inside the `<head>` element of each page. This element will have the `http-equiv="content-security-policy"` attribute, and the `content` attribute will provide values for the `script-src` and `style-src` directives based on the script and styles used in the page.


    <head>

      <meta

        http-equiv="content-security-policy"

        content="

        script-src 'self' 'sha256-somehash';

        style-src 'self' 'sha256-somehash';

        "

      >

    </head>

You can further customize the `<meta>` element by enabling this feature with a configuration object that includes additional options.

##### security.csp.algorithm


**Type:** `"SHA-256" | "SHA-384" | "SHA-512"`
**Default:** `'SHA-256'`


**Added in:** `astro@6.0.0`

The [hash function](https://developer.mozilla.org/en-US/docs/Glossary/Hash_function) to use when generating the hashes of the styles and scripts emitted by Astro.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

         algorithm: 'SHA-512'

        }

      }

    });

##### security.csp.directives


**Type:** `Array<string>`
**Default:** `[]`


**Added in:** `astro@6.0.0`

A list of [CSP directives](https://content-security-policy.com/#directive) (beyond `script-src` and `style-src` which are included by default) that defines valid sources for specific content types. These directives are added to all pages.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          directives: [

            "default-src 'self'",

            "img-src 'self' https://images.cdn.example.com"

          ]

        }

      }

    });

After the build, the `<meta>` element will add your directives into the `content` value alongside Astro’s default directives:


    <meta

      http-equiv="content-security-policy"

      content="

        default-src 'self';

        img-src 'self' 'https://images.cdn.example.com';

        script-src 'self' 'sha256-somehash';

        style-src 'self' 'sha256-somehash';

      "

    >

##### security.csp.styleDirective


**Type:** `CspStyleDirective`
**Default:** `undefined`


**Added in:** `astro@6.0.0`

A configuration object that allows you to override the default sources for the `style-src` directive with the `resources` property, or to provide additional hashes to be rendered.

###### security.csp.styleDirective.hashes


**Type:** `Array<CspHashEntry>`
**Default:** `[]`


**Added in:** `astro@6.0.0`

A list of additional hashes to be rendered.

You must provide hashes that start with `sha384-`, `sha512-` or `sha256-`. Other values will cause a validation error. These hashes are added to all pages.

Since Astro v7.1, each entry can be a string or an object. The object allows changing the scope of the hash via the `kind` field. The `kind` field accepts:

  * `"element"`: it will store the hash in the `style-src-elem` directive
  * `"attribute"`: it will store the hash in the `style-src-attr` directive
  * `"default"`: it will store the hash in the `style-src` directive


A `"default"` hash goes on `style-src`, or on `style-src-elem` instead once you use `kind: "element"`. It is never added to `style-src-attr`. Astro’s generated hashes follow the same rule.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          styleDirective: {

            hashes: [

              "sha384-styleHash",

              "sha512-styleHash",

              "sha256-styleHash"

            ]

          }

        }

      }

    });

After the build, the `<meta>` element will include your additional hashes in the `style-src` directives:


    <meta

      http-equiv="content-security-policy"

      content="

        style-src 'self' 'sha384-styleHash' 'sha512-styleHash' 'sha256-styleHash' 'sha256-generatedByAstro';

      "

    >

Scoping a hash to `"element"` stores it in `style-src-elem` instead. Astro’s generated hashes move there too:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          styleDirective: {

            hashes: [{ hash: "sha256-styleHash", kind: "element" }]

          }

        }

      }

    });

After the build, the `<meta>` element will include the hash in the `style-src-elem` directive instead of `style-src`:


    <meta

      http-equiv="content-security-policy"

      content="

        style-src 'self';

        style-src-elem 'self' 'sha256-styleHash' 'sha256-generatedByAstro';

      "

    >

###### security.csp.styleDirective.resources


**Type:** `Array<CspResourceEntry>`
**Default:** `[]`


**Added in:** `astro@6.0.0`

A list of valid sources for `style-src` directives to override Astro’s default sources. This will not include `'self'` by default, and must be included in this list if you wish to keep it. These resources are added to all pages.

Since Astro v7.1, each entry can be a string or an object. The object allows changing the scope of the source via the `kind` field. The `kind` field accepts:

  * `"element"`: it will store the source in the `style-src-elem` directive
  * `"attribute"`: it will store the source in the `style-src-attr` directive
  * `"default"`: it will store the source in the `style-src` directive


`"attribute"` sources must be one of `'none'`, `'unsafe-hashes'`, `'unsafe-inline'`, or `'report-sample'`, and `'unsafe-hashes'` cannot be used with `"element"`. A common use is allowing inline `style` attributes (for example, from `define:vars` or Shiki) with `{ resource: "'unsafe-inline'", kind: "attribute" }`.

Unlike a hash, a `"default"` source is never moved: it stays on `style-src` only. Where there is a mix of “default” and specific resources (e.g. `"element"` or `"attribute"`), Astro emits a warning.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          styleDirective: {

            resources: [

              "'self'",

              "https://styles.cdn.example.com"

            ]

          }

        }

      }

    });

After the build, the `<meta>` element will instead apply your sources to the `style-src` directives:


    <head>

      <meta

        http-equiv="content-security-policy"

        content="

         style-src 'self' https://styles.cdn.example.com 'sha256-somehash';

        "

      >

    </head>

A `"default"` source is not copied into the more specific directives. Here, a `"default"` source and an `"element"` source render in different directives:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          styleDirective: {

            resources: [

              "https://styles.cdn.example.com",

              { resource: "https://elements.cdn.example.com", kind: "element" }

            ]

          }

        }

      }

    });

After the build, the `<meta>` element keeps `https://styles.cdn.example.com` on `style-src` only. This means that this value is not added to `style-src-elem` and does not apply to `<style>` and `<link>` elements (the generated hash, by contrast, does move there):


    <meta

      http-equiv="content-security-policy"

      content="

        style-src https://styles.cdn.example.com;

        style-src-elem https://elements.cdn.example.com 'sha256-generatedByAstro';

      "

    >

When resources are inserted multiple times or from multiple sources (e.g. defined in your `csp` config and added using [the CSP runtime API](/en/reference/api-reference/#csp)), Astro will merge and deduplicate all resources to create your `<meta>` element.

##### security.csp.scriptDirective


**Type:** `CspScriptDirective`
**Default:** `undefined`


**Added in:** `astro@6.0.0`

A configuration object that allows you to override the default sources for the `script-src` directive with the `resources` property, or to provide additional hashes to be rendered.

###### security.csp.scriptDirective.hashes


**Type:** `Array<CspHashEntry>`
**Default:** `[]`


**Added in:** `astro@6.0.0`

A list of additional hashes to be rendered.

You must provide hashes that start with `sha384-`, `sha512-` or `sha256-`. Other values will cause a validation error. These hashes are added to all pages.

Since Astro v7.1, each entry can be a string or an object. The object allows changing the scope of the hash via the `kind` field. The `kind` field accepts:

  * `"element"`: it will store the hash in the `script-src-elem` directive
  * `"attribute"`: it will store the hash in the `script-src-attr` directive
  * `"default"`: it will store the hash in the `script-src` directive


A `"default"` hash goes on `script-src`, or on `script-src-elem` instead once you use `kind: "element"`. It is never added to `script-src-attr`. Astro’s generated hashes follow the same rule.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          scriptDirective: {

            hashes: [

              "sha384-scriptHash",

              "sha512-scriptHash",

              "sha256-scriptHash"

            ]

          }

        }

      }

    });

After the build, the `<meta>` element will include your additional hashes in the `script-src` directives:


    <meta

      http-equiv="content-security-policy"

      content="

        script-src 'self' 'sha384-scriptHash' 'sha512-scriptHash' 'sha256-scriptHash' 'sha256-generatedByAstro';

      "

    >

Scoping a hash to `"element"` stores it in `script-src-elem` instead. Astro’s generated hashes move there too:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          scriptDirective: {

            hashes: [{ hash: "sha256-scriptHash", kind: "element" }]

          }

        }

      }

    });

After the build, the `<meta>` element will include the hash in the `script-src-elem` directive instead of `script-src`:


    <meta

      http-equiv="content-security-policy"

      content="

        script-src 'self';

        script-src-elem 'self' 'sha256-scriptHash' 'sha256-generatedByAstro';

      "

    >

###### security.csp.scriptDirective.resources


**Type:** `Array<CspResourceEntry>`
**Default:** `[]`


**Added in:** `astro@6.0.0`

A list of valid sources for the `script-src` directives to override Astro’s default sources. This will not include `'self'` by default, and must be included in this list if you wish to keep it. These resources are added to all pages.

Since Astro v7.1, each entry can be a string or an object. The object allows changing the scope of the source via the `kind` field. The `kind` field accepts:

  * `"element"`: it will store the source in the `script-src-elem` directive
  * `"attribute"`: it will store the source in the `script-src-attr` directive
  * `"default"`: it will store the source in the `script-src` directive


`"attribute"` sources must be one of `'none'`, `'unsafe-hashes'`, `'unsafe-inline'`, or `'report-sample'`, and `'unsafe-hashes'` cannot be used with `"element"`.

Unlike a hash, a `"default"` source is never moved and stays on `script-src` only. This does not apply where you also scope `"element"` or `"attribute"` sources, since browsers do not fall back. Astro warns when this happens. Add it to the more specific directive as well, if necessary.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          scriptDirective: {

            resources: [

              "'self'", "https://cdn.example.com"

            ]

          }

        }

      }

    });

After the build, the `<meta>` element will instead apply your sources to the `script-src` directives:


    <head>

      <meta

        http-equiv="content-security-policy"

        content="

         script-src 'self' https://cdn.example.com 'sha256-somehash';

        "

      >

    </head>

A `"default"` source is not copied into the more specific directives. Here, a `"default"` source and an `"element"` source render in different directives:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          scriptDirective: {

            resources: [

              "https://cdn.example.com",

              { resource: "https://elements.cdn.example.com", kind: "element" }

            ]

          }

        }

      }

    });

After the build, the `<meta>` element keeps `https://cdn.example.com` on `script-src` only. This means that this value is not added to `script-src-elem` and does not apply to `<script>` elements (the generated hash, by contrast, does move there):


    <meta

      http-equiv="content-security-policy"

      content="

        script-src https://cdn.example.com;

        script-src-elem https://elements.cdn.example.com 'sha256-generatedByAstro';

      "

    >

When resources are inserted multiple times or from multiple sources (e.g. defined in your `csp` config and added using [the CSP runtime API](/en/reference/api-reference/#csp)), Astro will merge and deduplicate all resources to create your `<meta>` element.

###### security.csp.scriptDirective.strictDynamic


**Type:** `boolean`
**Default:** `false`


**Added in:** `astro@6.0.0`

Enables [the `strict-dynamic` keyword](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP#the_strict-dynamic_keyword) to support the dynamic injection of scripts.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      security: {

        csp: {

          scriptDirective: {

            strictDynamic: true

          }

        }

      }

    });

This applies to `script-src`. When you also scope `script` resources or hashes to `script-src-elem` (using `kind: "element"`), `strict-dynamic` is inherited by `script-src-elem` so that dynamically injected `<script>` elements continue to work.

## Build Options


### build.format


**Type:** `('file' | 'directory' | 'preserve')`
**Default:** `'directory'`

Control the output file format of each page. This value may be set by an adapter for you.

  * `'file'`: Astro will generate an HTML file named for each page route. (e.g. `src/pages/about.astro` and `src/pages/about/index.astro` both build the file `/about.html`)
  * `'directory'`: Astro will generate a directory with a nested `index.html` file for each page. (e.g. `src/pages/about.astro` and `src/pages/about/index.astro` both build the file `/about/index.html`)
  * `'preserve'`: Astro will generate HTML files exactly as they appear in your source folder. (e.g. `src/pages/about.astro` builds `/about.html` and `src/pages/about/index.astro` builds the file `/about/index.html`)


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        // Example: Generate `page.html` instead of `page/index.html` during build.

        format: 'file'

      }

    });

#### Effect on Astro.url


Setting `build.format` controls what `Astro.url` is set to during the build. When it is:

  * `directory` \- The `Astro.url.pathname` will include a trailing slash to mimic folder behavior. (e.g. `/foo/`)
  * `file` \- The `Astro.url.pathname` will include `.html`. (e.g. `/foo.html`)
  * `preserve` \- The `Astro.url.pathname` matches the generated file for each page: index pages include a trailing slash (e.g. `/foo/`), while non-index pages include `.html` (e.g. `/foo.html`).


This means that when you create relative URLs using `new URL('./relative', Astro.url)`, you will get consistent behavior between dev and build.

To prevent inconsistencies with trailing slash behaviour in dev, you can restrict the `trailingSlash` option to `'always'` or `'never'` depending on your build format:

  * `directory` \- Set `trailingSlash: 'always'`
  * `file` \- Set `trailingSlash: 'never'`


### build.client


**Type:** `string`
**Default:** `'./client'`

Controls the output directory of your client-side CSS and JavaScript when building a website with server-rendered pages. `outDir` controls where the code is built to.

This value is relative to the `outDir`.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      output: 'server',

      build: {

        client: './client'

      }

    });

### build.server


**Type:** `string`
**Default:** `'./server'`

Controls the output directory of server JavaScript when building to SSR.

This value is relative to the `outDir`.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        server: './server'

      }

    });

### build.assets


**Type:** `string`
**Default:** `'_astro'`


**Added in:** `astro@2.0.0`

Specifies the directory in the build output where Astro-generated assets (bundled JS and CSS for example) should live.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        assets: '_custom'

      }

    });

**See Also:**

  * outDir


### build.assetsPrefix


**Type:** `string | Record<string, string>`
**Default:** `undefined`


**Added in:** `astro@2.2.0`

Specifies the prefix for Astro-generated asset links. This can be used if assets are served from a different domain than the current site.

This requires uploading the assets in your local `./dist/_astro` folder to a corresponding `/_astro/` folder on the remote domain. To rename the `_astro` path, specify a new directory in `build.assets`.

To fetch all assets uploaded to the same domain (e.g. `https://cdn.example.com/_astro/...`), set `assetsPrefix` to the root domain as a string (regardless of your `base` configuration):

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        assetsPrefix: 'https://cdn.example.com'

      }

    });

**Added in:** `astro@4.5.0`

You can also pass an object to `assetsPrefix` to specify a different domain for each file type. In this case, a `fallback` property is required and will be used by default for any other files.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        assetsPrefix: {

          'js': 'https://js.cdn.example.com',

          'mjs': 'https://js.cdn.example.com',

          'css': 'https://css.cdn.example.com',

          'fallback': 'https://cdn.example.com'

        }

      }

    });

### build.serverEntry


**Type:** `string`
**Default:** `'entry.mjs'`

Specifies the file name of the server entrypoint when building to SSR. This entrypoint is usually dependent on which host you are deploying to and will be set by your adapter for you.

Note that it is recommended that this file ends with `.mjs` so that the runtime detects that the file is a JavaScript module.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        serverEntry: 'main.mjs'

      }

    });

### build.redirects


**Type:** `boolean`
**Default:** `true`


**Added in:** `astro@2.6.0`

Specifies whether redirects will be output to HTML during the build. This option only applies to `output: 'static'` mode; in SSR redirects are treated the same as all responses.

This option is mostly meant to be used by adapters that have special configuration files for redirects and do not need/want HTML based redirects.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        redirects: false

      }

    });

### build.inlineStylesheets


**Type:** `'always' | 'auto' | 'never'`
**Default:** `auto`


**Added in:** `astro@2.6.0`

Control whether project styles are sent to the browser in a separate css file or inlined into `<style>` tags. Choose from the following options:

  * `'always'` \- project styles are inlined into `<style>` tags
  * `'auto'` \- only stylesheets smaller than `ViteConfig.build.assetsInlineLimit` (default: 4kb) are inlined. Otherwise, project styles are sent in external stylesheets.
  * `'never'` \- project styles are sent in external stylesheets


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        inlineStylesheets: `never`,

      },

    });

### build.concurrency


**Type:** `number`
**Default:** `1`


**Added in:** `astro@4.16.0`

The number of pages to build in parallel.

**In most cases, you should not change the default value of`1`.**

Use this option only when other attempts to reduce the overall rendering time (e.g. batch or cache long running tasks like fetch calls or data access) are not possible or are insufficient. If the number is set too high, page rendering may slow down due to insufficient memory resources and because JS is single-threaded.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      build: {

        concurrency: 2

      }

    });

## Server Options


Customize the Astro dev server, used by both `astro dev` and `astro preview`.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      server: { port: 1234, host: true}

    });

To set different configuration based on the command run (“dev”, “preview”) a function can also be passed to this configuration option.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      // Example: Use the function syntax to customize based on command

      server: ({ command }) => ({ port: command === 'dev' ? 4321 : 4000 })

    });

### server.host


**Type:** `string | boolean`
**Default:** `false`


**Added in:** `astro@0.24.0`

Set which network IP addresses the server should listen on (i.e. non-localhost IPs).

  * `false` \- do not expose on a network IP address
  * `true` \- listen on all addresses, including LAN and public addresses
  * `[custom-address]` \- expose on a network IP address at `[custom-address]` (ex: `192.168.0.1`)


### server.port


**Type:** `number`
**Default:** `4321`

Set which port the server should listen on.

If the given port is already in use, Astro will automatically try the next available port.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      server: { port: 8080 }

    });

### server.allowedHosts


**Type:** `Array<string> | true`
**Default:** `[]`


**Added in:** `astro@5.4.0`

A list of hostnames that Astro is allowed to respond to. When the value is set to `true`, any hostname is allowed.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      server: {

        allowedHosts: ['staging.example.com', 'qa.example.com']

      }

    });

### server.open


**Type:** `string | boolean`
**Default:** `false`


**Added in:** `astro@4.1.0`

Controls whether the dev server should open in your browser window on startup.

Pass a full URL string (e.g. “<http://example.com>”) or a pathname (e.g. “/about”) to specify the URL to open.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      server: { open: "/about" }

    });

### server.headers


**Type:** `OutgoingHttpHeaders`
**Default:** `{}`


**Added in:** `astro@1.7.0`

Set custom HTTP response headers to be sent in `astro dev` and `astro preview`.

## fetchFile


**Type:** `string | null`
**Default:** `'fetch'`


**Added in:** `astro@7.0.0`

Customizes the file used as the fetch entrypoint inside `srcDir`. Defaults to `'fetch'`, meaning Astro looks for `src/fetch.ts` (or `.js` / `.mjs` / `.mts`).

The fetch file allows you to compose Astro’s request pipeline with the Web Fetch standard or your own Hono middleware.

If you already have a `src/fetch.ts` file in use for other purposes, define a different filename or set the value to `null` to disable the entrypoint:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      fetchFile: 'handler',

    });

Learn more about customizing the request pipeline in the [advanced routing guide](/en/guides/routing/#advanced-routing).

## Logger Options


**Type:** `LoggerHandlerConfig`
**Default:** `undefined`


**Added in:** `astro@7.0.0`

Configures how Astro logs messages during development and production.

By default, Astro uses a built-in logger that outputs human-friendly logs to the console. You can customize this behavior by providing [your own logger handler](/en/reference/logger-reference/#custom-loggers) or by using one of the [built-in log handlers](/en/reference/logger-reference/#built-in-loggers):

astro.config.mjs


    import { defineConfig, logHandlers } from 'astro/config';


    export default defineConfig({

      logger: logHandlers.json({ level: 'info' })

    });

See [the logger API reference](/en/reference/logger-reference/) for more information.

### logger.entrypoint


**Type:** `string | URL`


**Added in:** `astro@7.0.0`

The entrypoint for the [logger implementation](/en/reference/logger-reference/#the-logger-implementation). This can be an npm package, a path relative to your project root, or a `URL` pointing to a file in your project:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      logger: {

        entrypoint: "@org/astro-logger",

      }

    });

The logger entrypoint must be a JavaScript file. TypeScript is not supported. If Astro fails to load the implementation, it falls back to its default logger.

### logger.config


**Type:** `Record<string, unknown> | undefined`
**Default:** `{}`


**Added in:** `astro@7.0.0`

The configuration object for the log handler. The options depend on the configured logger.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      logger: {

        entrypoint: "@org/astro-logger",

        config: {

         level: "error"

        }

      }

    });

## Session Options


**Type:** `object | false`


**Added in:** `astro@5.7.0`

Configures session storage for your Astro project. This is used to store session data in a persistent way, so that it can be accessed across different requests.

Some adapters may provide a default session driver, but you can override it with your own configuration:

astro.config.mjs


    import { defineConfig, sessionDrivers } from 'astro/config';


    export default defineConfig({

      session: {

        driver: sessionDrivers.redis({

          // The options are driver-dependent and some may be required.

          url: process.env.REDIS_URL

        }),

      }

    });

Session drivers are configured at build time. This means environment variables used in the driver configuration are inlined. You must create your own driver entrypoint to [override the configuration at runtime](/en/guides/sessions/#overriding-the-configuration-at-runtime).

Since Astro v7.2.0, you can opt out of session support by setting the option to `false`. When sessions are disabled, the session runtime is excluded from the SSR bundle, and adapters skip wiring their default session driver. This is useful for serverless and edge runtimes where bundle parse time is sensitive.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      session: false,

    });

See [the sessions guide](/en/guides/sessions/) for more information.

### session.driver


**Type:** `SessionDriverConfig | undefined`


**Added in:** `astro@5.7.0`

The driver to use for session storage. The [Node](/en/guides/integrations-guide/node/#sessions), [Cloudflare](/en/guides/integrations-guide/cloudflare/#sessions), and [Netlify](/en/guides/integrations-guide/netlify/#sessions) adapters automatically configure a default driver for you, but you can specify your own if you would prefer or if you are using an adapter that does not provide one.

astro.config.mjs


    import { defineConfig, sessionDrivers } from 'astro/config'

    import vercel from '@astrojs/vercel'


    export default defineConfig({

      adapter: vercel(),

      session: {

        driver: sessionDrivers.redis({

          url: process.env.REDIS_URL

        }),

      }

    });

### session.options


**Type:** `Record<string, unknown> | undefined`
**Default:** `{}`


**Added in:** `astro@5.7.0`

The driver-specific options to use for session storage. The options depend on the driver you are using. See the [Unstorage documentation](https://unstorage.unjs.io/drivers) for more information on the options available for each driver.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      session: {

        driver: "redis",

        options: {

          url: process.env.REDIS_URL

        },

      }

    });

### session.cookie


**Type:** `string | AstroCookieSetOptions | undefined`
**Default:** `{ name: "astro-session", sameSite: "lax", httpOnly: true, secure: true }`


**Added in:** `astro@5.7.0`

The session cookie configuration. If set to a string, it will be used as the cookie name. Alternatively, you can pass an object with additional options. These will be merged with the defaults.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      session: {

        // If set to a string, it will be used as the cookie name.

        cookie: "my-session-cookie",

      }

    });

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      session: {

        // If set to an object, it will be used as the cookie options.

        cookie: {

          name: "my-session-cookie",

          sameSite: "lax",

          secure: true,

        }

      }

    });

### session.ttl


**Type:** `number | undefined`
**Default:** Infinity


**Added in:** `astro@5.7.0`

An optional default time-to-live expiration period for session values, in seconds.

By default, session values persist until they are deleted or the session is destroyed, and do not automatically expire because a particular amount of time has passed. Set `session.ttl` to add a default expiration period for your session values. Passing a `ttl` option to [`session.set()`](/en/reference/api-reference/#sessionset) will override the global default for that individual entry.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      session: {

        // Set a default expiration period of 1 hour (3600 seconds)

        ttl: 3600,

      }

    });

## Dev Toolbar Options


### devToolbar.enabled


**Type:** `boolean`
**Default:** `true`

Whether to enable the Astro Dev Toolbar. This toolbar allows you to inspect your page islands, see helpful audits on performance and accessibility, and more.

This option is scoped to the entire project, to only disable the toolbar for yourself, run `npm run astro preferences disable devToolbar`. To disable the toolbar for all your Astro projects, run `npm run astro preferences disable devToolbar --global`.

### devToolbar.placement


**Type:** `'bottom-left' | 'bottom-center' | 'bottom-right'`
**Default:** `'bottom-center'`


**Added in:** `astro@5.17.0`

The default placement of the Astro Dev Toolbar on the screen.

The placement of the toolbar can still be changed via the toolbar settings UI. Once changed, the user’s preference is saved in `localStorage` and overrides this configuration value.

## Prefetch Options


**Type:** `boolean | object`

Enable prefetching for links on your site to provide faster page transitions. (Enabled by default on pages using the `<ClientRouter />` router. Set `prefetch: false` to opt out of this behaviour.)

This configuration automatically adds a prefetch script to every page in the project giving you access to the `data-astro-prefetch` attribute. Add this attribute to any `<a />` link on your page to enable prefetching for that page.


    <a href="/about" data-astro-prefetch>About</a>

Further customize the default prefetching behavior using the `prefetch.defaultStrategy` and `prefetch.prefetchAll` options.

See the [Prefetch guide](/en/guides/prefetch/) for more information.

### prefetch.prefetchAll


**Type:** `boolean`

Enable prefetching for all links, including those without the `data-astro-prefetch` attribute. This value defaults to `true` when using the `<ClientRouter />` router. Otherwise, the default value is `false`.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      prefetch: {

        prefetchAll: true,

      },

    });

When set to `true`, you can disable prefetching individually by setting `data-astro-prefetch="false"` on any individual links.


    <a href="/about" data-astro-prefetch="false">About</a>

### prefetch.defaultStrategy


**Type:** `'tap' | 'hover' | 'viewport' | 'load'`
**Default:** `'hover'`

The default prefetch strategy to use when the `data-astro-prefetch` attribute is set on a link with no value.

  * `'tap'`: Prefetch just before you click on the link.
  * `'hover'`: Prefetch when you hover over or focus on the link. (default)
  * `'viewport'`: Prefetch as the links enter the viewport.
  * `'load'`: Prefetch all links on the page after the page is loaded.


You can override this default value and select a different strategy for any individual link by setting a value on the attribute.


    <a href="/about" data-astro-prefetch="viewport">About</a>

## Image Options


### image.endpoint


**Type:** `Object`
**Default:** `{route: '/_image', entrypoint: undefined}`


**Added in:** `astro@3.1.0`

Set the endpoint to use for image optimization in dev and SSR. The `entrypoint` property can be set to `undefined` to use the default image endpoint.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      image: {

        // Example: Use a custom image endpoint at `/custom_endpoint`

        endpoint: {

          route: '/custom_endpoint',

          entrypoint: 'src/my_endpoint.ts',

        },

      },

    });

### image.service


**Type:** `Object`
**Default:** `{entrypoint: 'astro/assets/services/sharp', config?: {}}`


**Added in:** `astro@2.1.0`

Set which image service is used for Astro’s assets support.

The value should be an object with an entrypoint for the image service to use and optionally, a config object to pass to the service.

The service entrypoint can be either one of the included services, or a third-party package.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      image: {

        // Example: Enable the Sharp-based image service with a custom config

        service: {

          entrypoint: 'astro/assets/services/sharp',

          config: {

            limitInputPixels: false,

            webp: {

              effort: 6,

              alphaQuality: 80,

            },

            jpeg: {

              mozjpeg: true,

            },

          },

        },

      },

    });

#### image.service.config.limitInputPixels


**Type:** `number | boolean`
**Default:** `true`


**Added in:** `astro@4.1.0`

Whether or not to limit the size of images that the Sharp image service will process.

Set `false` to bypass the default image size limit for the Sharp image service and process large images.

#### image.service.config.kernel


**Type:** `string | undefined`
**Default:** `undefined`


**Added in:** `astro@5.17.0`

The default [kernel used for resizing images](https://sharp.pixelplumbing.com/api-resize/#resize) in the Sharp image service.

By default this is `undefined`, which maps to Sharp’s default kernel of `lanczos3`.

#### image.service.config.jpeg


**Type:** `Record<string, any> | undefined`
**Default:** `undefined`


**Added in:** `astro@6.1.0`

The default encoder options passed to `sharp().jpeg()` when using Astro’s built-in Sharp image service.

This can be used for options such as `mozjpeg`, `progressive`, `chromaSubsampling`, or a default `quality`. Per-image `quality` values from `<Image />`, `<Picture />`, and `getImage()` still take precedence.

#### image.service.config.webp


**Type:** `Record<string, any> | undefined`
**Default:** `undefined`


**Added in:** `astro@6.1.0`

The default encoder options passed to `sharp().webp()` when using Astro’s built-in Sharp image service.

This can be used for options such as `effort`, `alphaQuality`, `lossless`, `nearLossless`, or a default `quality`. Per-image `quality` values from `<Image />`, `<Picture />`, and `getImage()` still take precedence.

#### image.service.config.avif


**Type:** `Record<string, any> | undefined`
**Default:** `undefined`


**Added in:** `astro@6.1.0`

The default encoder options passed to `sharp().avif()` when using Astro’s built-in Sharp image service.

This can be used for options such as `effort`, `chromaSubsampling`, `bitdepth`, `lossless`, or a default `quality`. Per-image `quality` values from `<Image />`, `<Picture />`, and `getImage()` still take precedence.

#### image.service.config.png


**Type:** `Record<string, any> | undefined`
**Default:** `undefined`


**Added in:** `astro@6.1.0`

The default encoder options passed to `sharp().png()` when using Astro’s built-in Sharp image service.

This can be used for options such as `compressionLevel`, `effort`, `palette`, or a default `quality`. Per-image `quality` values from `<Image />`, `<Picture />`, and `getImage()` still take precedence.

### image.dangerouslyProcessSVG


**Type:** `boolean`
**Default:** `false`


**Added in:** `astro@6.3.0`

Allows SVG source images to be processed by the image optimization pipeline.

This is disabled by default as specifically formed SVGs can be prohibitively expensive to process and used by malicious actors to execute denial of service attacks. Only enable this option if you trust the source of your SVG images and understand the risks of processing them.

### image.domains


**Type:** `Array<string>`
**Default:** `[]`


**Added in:** `astro@2.10.10`

Defines a list of permitted image source domains for remote image optimization. No other remote images will be optimized by Astro.

This option requires an array of individual domain names as strings. Wildcards are not permitted. Instead, use `image.remotePatterns` to define a list of allowed source URL patterns.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      image: {

        // Example: Allow remote image optimization from a single domain

        domains: ['astro.build'],

      },

    });

### image.remotePatterns


**Type:** `Array<RemotePattern>`
**Default:** `[]`


**Added in:** `astro@2.10.10`

Defines a list of permitted image source URL patterns for remote image optimization.

`remotePatterns` can be configured with four properties:

  1. protocol
  2. hostname
  3. port
  4. pathname


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      image: {

        // Example: allow processing all images from your aws s3 bucket

        remotePatterns: [{

          protocol: 'https',

          hostname: '**.amazonaws.com',

        }],

      },

    });

You can use wildcards to define the permitted `hostname` and `pathname` values as described below. Otherwise, only the exact values provided will be configured.

`hostname` patterns:

  * Start with `**.` to allow all subdomains (like `endsWith`).
  * Start with `*.` to allow only one level of subdomain.


`pathname` patterns:

  * End with `/**` to allow all sub-routes (like `startsWith`).
  * End with `/*` to allow only one level of sub-route.


HTTP redirects are also followed when an image URL matches a remote pattern. The final destination URL must be among the allowed remote patterns to be loaded.

### image.responsiveStyles


**Type:** `boolean`
**Default:** `false`


**Added in:** `astro@5.10.0`

Whether to automatically add global styles for responsive images. You should enable this option unless you are styling the images yourself.

This option is only used when `layout` is set to `constrained`, `full-width`, or `fixed` using the configuration or the `layout` prop on the image component.

See [the images docs](/en/guides/images/#responsive-image-styles) for more information.

### image.layout


**Type:** `ImageLayout`
**Default:** `undefined`


**Added in:** `astro@5.10.0`

The default layout type for responsive images. Can be overridden by the `layout` prop on the image component.

  * `constrained` \- The image will scale to fit the container, maintaining its aspect ratio, but will not exceed the specified dimensions.
  * `fixed` \- The image will maintain its original dimensions.
  * `full-width` \- The image will scale to fit the container, maintaining its aspect ratio.


See [the `layout` component property](/en/reference/modules/astro-assets/#layout) for more details.

### image.objectFit


**Type:** `ImageFit`
**Default:** `"cover"`


**Added in:** `astro@5.10.0`

The [`object-fit` CSS property value](https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit) for responsive images. Can be overridden by the `fit` prop on the image component. Requires a value for `layout` to be set.

See [the `fit` component property](/en/reference/modules/astro-assets/#fit) for more details.

### image.objectPosition


**Type:** `string`
**Default:** `"center"`


**Added in:** `astro@5.10.0`

The default [`object-position` CSS property value](https://developer.mozilla.org/en-US/docs/Web/CSS/object-position) for responsive images. Can be overridden by the `position` prop on the image component. Requires a value for `layout` to be set.

See [the `position` component property](/en/reference/modules/astro-assets/#position) for more details.

### image.breakpoints


**Type:** `Array<number>`
**Default:** `[640, 750, 828, 1080, 1280, 1668, 2048, 2560] | [640, 750, 828, 960, 1080, 1280, 1668, 1920, 2048, 2560, 3200, 3840, 4480, 5120, 6016]`


**Added in:** `astro@5.10.0`

The breakpoints used to generate responsive images. Requires a value for `layout` to be set. The full list is not normally used, but is filtered according to the source and output size. The defaults used depend on whether a local or remote image service is used. For remote services the more comprehensive list is used, because only the required sizes are generated. For local services, the list is shorter to reduce the number of images generated.

## Markdown Options


### markdown.shikiConfig


**Type:** `Partial<ShikiConfig>`

Shiki is our default syntax highlighter. You can configure all options via the `markdown.shikiConfig` object:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      markdown: {

        shikiConfig: {

          // Choose from Shiki's built-in themes (or add your own)

          // https://shiki.style/themes

          theme: 'dracula',

          // Alternatively, provide multiple themes

          // See note below for using dual light/dark themes

          themes: {

            light: 'github-light',

            dark: 'github-dark',

          },

          // Disable the default colors

          // https://shiki.style/guide/dual-themes#without-default-color

          // (Added in v4.12.0)

          defaultColor: false,

          // Add custom languages

          // Note: Shiki has countless langs built-in, including .astro!

          // https://shiki.style/languages

          langs: [],

          // Add custom aliases for languages

          // Map an alias to a Shiki language ID: https://shiki.style/languages#bundled-languages

          // https://shiki.style/guide/load-lang#custom-language-aliases

          langAlias: {

            cjs: "javascript"

          },

          // Enable word wrap to prevent horizontal scrolling

          wrap: true,

          // Add custom transformers: https://shiki.style/guide/transformers

          // Find common transformers: https://shiki.style/packages/transformers

          transformers: [],

        },

      },

    });

See the [code syntax highlighting guide](/en/guides/syntax-highlighting/) for usage and examples.

### markdown.syntaxHighlight


**Type:** `SyntaxHighlightConfig | SyntaxHighlightConfigType | false`
**Default:** `{ type: 'shiki', excludeLangs: ['math'] }`

Which syntax highlighter to use for Markdown code blocks (```), if any. This determines the CSS classes that Astro will apply to your Markdown code blocks.

  * `shiki` \- use the [Shiki](https://shiki.style) highlighter (`github-dark` theme configured by default)
  * `prism` \- use the [Prism](https://prismjs.com/) highlighter and [provide your own Prism stylesheet](/en/guides/syntax-highlighting/#add-a-prism-stylesheet)
  * `false` \- do not apply syntax highlighting.


astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      markdown: {

        // Example: Switch to use prism for syntax highlighting in Markdown

        syntaxHighlight: 'prism',

      }

    });

For more control over syntax highlighting, you can instead specify a configuration object with the properties listed below.

#### markdown.syntaxHighlight.type


**Type:** `'shiki' | 'prism'`
**Default:** `'shiki'`


**Added in:** `astro@5.5.0`

The default CSS classes to apply to Markdown code blocks. (If no other syntax highlighting configuration is needed, you can instead set `markdown.syntaxHighlight` directly to `shiki`, `prism`, or `false`.)

#### markdown.syntaxHighlight.excludeLangs


**Type:** `Array<string>`
**Default:** `['math']`


**Added in:** `astro@5.5.0`

An array of languages to exclude from the default syntax highlighting specified in `markdown.syntaxHighlight.type`. This can be useful when using tools that create diagrams from Markdown code blocks, such as Mermaid.js and D2.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      markdown: {

        syntaxHighlight: {

          type: 'shiki',

          excludeLangs: ['mermaid', 'math'],

        },

      },

    });

### markdown.remarkPlugins


**Type:** `RemarkPlugins`

Pass [remark plugins](https://github.com/remarkjs/remark) to customize how your Markdown is built. You can import and apply the plugin function (recommended), or pass the plugin name as a string.

astro.config.mjs


    import { defineConfig } from 'astro/config';

    import remarkToc from 'remark-toc';


    export default defineConfig({

      markdown: {

        remarkPlugins: [ [remarkToc, { heading: "contents"} ] ]

      }

    });

### markdown.rehypePlugins


**Type:** `RehypePlugins`

Pass [rehype plugins](https://github.com/remarkjs/remark-rehype) to customize how your Markdown’s output HTML is processed. You can import and apply the plugin function (recommended), or pass the plugin name as a string.

astro.config.mjs


    import { defineConfig } from 'astro/config';

    import { rehypeAccessibleEmojis } from 'rehype-accessible-emojis';


    export default defineConfig({

      markdown: {

        rehypePlugins: [rehypeAccessibleEmojis]

      }

    });

### markdown.gfm


**Type:** `boolean`
**Default:** `true`


**Added in:** `astro@2.0.0`

Astro uses [GitHub-flavored Markdown](https://github.com/remarkjs/remark-gfm) by default. To disable this, set the `gfm` flag to `false`:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      markdown: {

        gfm: false,

      }

    });

### markdown.smartypants


**Type:** `boolean | Smartypants`
**Default:** `true`


**Added in:** `astro@2.0.0`

Whether to use the [SmartyPants formatter](https://daringfireball.net/projects/smartypants/) to transform straight quotes into smart quotes, dashes into en/em dashes, and triple dots into ellipses.

To disable this, set the `smartypants` flag to `false`.

For more control over typography, you can instead specify a configuration object with the [properties supported by `retext-smartypants`](https://github.com/retextjs/retext-smartypants?tab=readme-ov-file#fields).

### markdown.remarkRehype


**Type:** `RemarkRehype`

Pass options to [remark-rehype](https://github.com/remarkjs/remark-rehype#api).

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      markdown: {

        // Example: Translate the footnotes text to another language, here are the default English values

        remarkRehype: { footnoteLabel: "Footnotes", footnoteBackLabel: "Back to reference 1"},

      },

    });

### markdown.processor


**Type:** `MarkdownProcessor`


**Added in:** `astro@6.4.0`

Configures the [Markdown processor](/en/guides/markdown-content/#markdown-processors) used to render `.md` files.

Sätteri, Astro’s native Markdown pipeline, is the default processor. To configure it, install `@astrojs/markdown-satteri` and pass options to `satteri()`:

astro.config.mjs


    import { defineConfig } from 'astro/config';

    import { satteri } from '@astrojs/markdown-satteri';


    export default defineConfig({

      markdown: {

        processor: satteri({

          features: { gfm: false },

        }),

      },

    });

To keep the remark/rehype pipeline, install `@astrojs/markdown-remark` and pass `unified()`:

astro.config.mjs


    import { defineConfig } from 'astro/config';

    import { unified } from '@astrojs/markdown-remark';

    import remarkToc from 'remark-toc';


    export default defineConfig({

      markdown: {

        processor: unified({

          remarkPlugins: [remarkToc],

        }),

      },

    });

Learn more about the [official Markdown processors and how to choose one](/en/guides/markdown-content/#choosing-a-markdown-processor) in the Markdown guide.

## i18n


**Type:** `object`


**Added in:** `astro@3.5.0`

Configures i18n routing and allows you to specify some customization options.

See our guide for more information on [internationalization in Astro](/en/guides/internationalization/)

### i18n.locales


**Type:** `Locales`


**Added in:** `astro@3.5.0`

A list of all locales supported by the website. This is a required field.

Languages can be listed either as individual codes (e.g. `['en', 'es', 'pt-br']`) or mapped to a shared `path` of codes (e.g. `{ path: "english", codes: ["en", "en-US"]}`). These codes will be used to determine the URL structure of your deployed site.

No particular language code format or syntax is enforced, but your project folders containing your content files must match exactly the `locales` items in the list. In the case of multiple `codes` pointing to a custom URL path prefix, store your content files in a folder with the same name as the `path` configured.

### i18n.defaultLocale


**Type:** `string`


**Added in:** `astro@3.5.0`

The default locale of your website/application, that is one of the specified `locales`. This is a required field.

No particular language format or syntax is enforced, but we suggest using lower-case and hyphens as needed (e.g. “es”, “pt-br”) for greatest compatibility.

### i18n.fallback


**Type:** `Record<string, string>`


**Added in:** `astro@3.5.0`

The fallback strategy when navigating to pages that do not exist (e.g. a translated page has not been created).

Use this object to declare a fallback `locale` route for each language you support. If no fallback is specified, then unavailable pages will return a 404.

##### Example


The following example configures your content fallback strategy to redirect unavailable pages in `/pt-br/` to their `es` version, and unavailable pages in `/fr/` to their `en` version. Unavailable `/es/` pages will return a 404.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      i18n: {

        defaultLocale: "en",

        locales: ["en", "fr", "pt-br", "es"],

        fallback: {

          "pt-br": "es",

          fr: "en"

        }

      }

    });

### i18n.routing


**Type:** `object | "manual"`
**Default:** `object`


**Added in:** `astro@3.7.0`

Controls the routing strategy to determine your site URLs. Set this based on your folder/URL path configuration for your default language.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      i18n: {

        defaultLocale: "en",

        locales: ["en", "fr"],

        routing: {

          prefixDefaultLocale: false,

          redirectToDefaultLocale: true,

          fallbackType: "redirect",

        }

      }

    });

Since 4.6.0, this option can also be set to `manual`. When this routing strategy is enabled, Astro will **disable** its i18n middleware and no other `routing` options (e.g. `prefixDefaultLocale`) may be configured. You will be responsible for writing your own routing logic, or executing Astro’s i18n middleware manually alongside your own.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      i18n: {

        defaultLocale: "en",

        locales: ["en", "fr"],

        routing: "manual"

      }

    });

#### i18n.routing.prefixDefaultLocale


**Type:** `boolean`
**Default:** `false`


**Added in:** `astro@3.7.0`

When `false`, only non-default languages will display a language prefix. The `defaultLocale` will not show a language prefix and content files do not exist in a localized folder. URLs will be of the form `example.com/[locale]/content/` for all non-default languages, but `example.com/content/` for the default locale.

When `true`, all URLs will display a language prefix. URLs will be of the form `example.com/[locale]/content/` for every route, including the default language. Localized folders are used for every language, including the default.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      i18n: {

        defaultLocale: "en",

        locales: ["en", "fr", "pt-br", "es"],

        routing: {

          prefixDefaultLocale: true,

        }

      }

    });

#### i18n.routing.redirectToDefaultLocale


**Type:** `boolean`
**Default:** `false`


**Added in:** `astro@4.2.0`

Configures whether or not the home URL (`/`) generated by `src/pages/index.astro` will redirect to `/[defaultLocale]` when `prefixDefaultLocale: true` is set.

Set `redirectToDefaultLocale: true` to enable this automatic redirection at the root of your site:

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      i18n:{

        defaultLocale: "en",

        locales: ["en", "fr"],

        routing: {

          prefixDefaultLocale: true,

          redirectToDefaultLocale: true

        }

      }

    });

#### i18n.routing.fallbackType


**Type:** `"redirect" | "rewrite"`
**Default:** `"redirect"`


**Added in:** `astro@4.15.0`

When `i18n.fallback` is configured to avoid showing a 404 page for missing page routes, this option controls whether to [redirect](/en/guides/routing/#redirects) to the fallback page, or to [rewrite](/en/guides/routing/#rewrites) the fallback page’s content in place.

By default, Astro’s i18n routing creates pages that redirect your visitors to a new destination based on your fallback configuration. The browser will refresh and show the destination address in the URL bar.

When `i18n.routing.fallback: "rewrite"` is configured, Astro will create pages that render the contents of the fallback page on the original, requested URL.

With the following configuration, if you have the file `src/pages/en/about.astro` but not `src/pages/fr/about.astro`, the `astro build` command will generate `dist/fr/about.html` with the same content as the `dist/en/about.html` page. Your site visitor will see the English version of the page at `https://example.com/fr/about/` and will not be redirected.

astro.config.mjs


    import { defineConfig } from 'astro/config';


    export default defineConfig({

      i18n: {

        defaultLocale: "en",

        locales: ["en", "fr"],

        routing: {

          prefixDefaultLocale: false,

          fallbackType: "rewrite",

        },

        fallback: {

          fr: "en",

        }

      },

    });

### i18n.domains


**Type:** `Record<string, string>`
**Default:** `{}`


**Added in:** `astro@4.3.0`

Configures the URL pattern of one or more supported languages to use a custom domain (or sub-domain).

When a locale is mapped to a domain, a `/[locale]/` path prefix will not be used. However, localized folders within `src/pages/` are still required, including for your configured `defaultLocale`.

Any other locale not configured will default to a localized path-based URL according to your `prefixDefaultLocale` strategy (e.g. `https://example.com/[locale]/blog`).

astro.config.mjs


    export default defineConfig({

      site: "https://example.com",

      output: "server", // required, with no prerendered pages

      adapter: node({

        mode: 'standalone',

      }),

      i18n: {

        defaultLocale: "en",

        locales: ["en", "fr", "pt-br", "es"],

        routing: {

          prefixDefaultLocale: false,

        },

        domains: {

          fr: "https://fr.example.com",

          es: "https://example.es"

        }

      },

    });

Both page routes built and URLs returned by the `astro:i18n` helper functions [`getAbsoluteLocaleUrl()`](/en/reference/modules/astro-i18n/#getabsolutelocaleurl) and [`getAbsoluteLocaleUrlList()`](/en/reference/modules/astro-i18n/#getabsolutelocaleurllist) will use the options set in `i18n.domains`.

See the [Internationalization Guide](/en/guides/internationalization/#domains) for more details, including the limitations of this feature.

## env


**Type:** `object`
**Default:** `{}`


**Added in:** `astro@5.0.0`

Configuration options for type-safe environment variables.

See our guide for more information on [environment variables in Astro](/en/guides/environment-variables/).

### env.schema


**Type:** `EnvSchema`
**Default:** `{}`


**Added in:** `astro@5.0.0`

Defines environment variables to be enforced by Zod validation and for which TypeScript support (e.g. autocompletion, type-safety) is available. Each key corresponds to the variable name and the value to the data type and validations [defined with `envField`](/en/reference/modules/astro-config/#envfield).

Four data types are supported: string, number, enumeration, and boolean. Each type requires a `context` (client or server), an `access` level (public or secret), and additional validations, such as a `default` value and an indication of whether the variable is `optional` (defaults to `false`).

astro.config.mjs


    import { defineConfig, envField } from "astro/config"


    export default defineConfig({

      env: {

        schema: {

          API_URL: envField.string({ context: "client", access: "public", optional: true }),

          PORT: envField.number({ context: "server", access: "public", default: 4321 }),

          API_SECRET: envField.string({ context: "server", access: "secret" }),

        }

      }

    });

### env.validateSecrets


**Type:** `boolean`
**Default:** `false`


**Added in:** `astro@5.0.0`

Whether or not to validate secrets on the server when starting the dev server or running a build.

By default, only public variables are validated on the server when starting the dev server or a build, and private variables are validated at runtime only. If enabled, private variables will also be checked on start. This is useful in some continuous integration (CI) pipelines to make sure all your secrets are correctly set before deploying.

astro.config.mjs


    import { defineConfig, envField } from "astro/config"


    export default defineConfig({

      env: {

        schema: {

          // ...

        },

        validateSecrets: true

      }

    });

## fonts


**Type:** `Array<FontFamily>`
**Default:** `[]`


**Added in:** `astro@6.0.0`

Configures fonts and allows you to specify some customization options on a per-font basis.

See our guide for more information on [using custom fonts in Astro](/en/guides/fonts/).

### font.provider


**Type:** `FontProvider`


**Added in:** `astro@6.0.0`

The source of your font files. You can use a [built-in provider](/en/reference/font-provider-reference/#built-in-providers) or write your own [custom provider](/en/reference/font-provider-reference/#building-a-font-provider):

astro.config.mjs


    import { defineConfig, fontProviders } from "astro/config";


    export default defineConfig({

      fonts: [{

        provider: fontProviders.google(),

        name: "Roboto",

        cssVariable: "--font-roboto"

      }]

    });

### font.name


**Type:** `string`


**Added in:** `astro@6.0.0`

The font family name, as identified by your font provider:


    name: "Roboto"

### font.cssVariable


**Type:** `string`


**Added in:** `astro@6.0.0`

A valid [ident](https://developer.mozilla.org/en-US/docs/Web/CSS/ident) of your choosing in the form of a CSS variable (i.e. starting with `--`):


    cssVariable: "--font-roboto"

### font.fallbacks


**Type:** `Array<string>`
**Default:** `["sans-serif"]`


**Added in:** `astro@6.0.0`

An array of fonts to use when your chosen font is unavailable, or loading. Fallback fonts will be chosen in the order listed. The first available font will be used:


    fallbacks: ["CustomFont", "serif"]

To disable fallback fonts completely, configure an empty array:


    fallbacks: []

Specify at least a [generic family name](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family#generic-name) matching the intended appearance of your font. Astro will then attempt to generate [optimized fallbacks](https://developer.chrome.com/blog/font-fallbacks) using font metrics. To disable this optimization, set `optimizedFallbacks` to false.

### font.optimizedFallbacks


**Type:** `boolean`
**Default:** `true`


**Added in:** `astro@6.0.0`

Whether or not to enable Astro’s default optimization when generating fallback fonts. You may disable this default optimization to have full control over how `fallbacks` are generated:


    optimizedFallbacks: false

### font.weights


**Type:** `Array<(number|string)>`
**Default:** `[400]`


**Added in:** `astro@6.0.0`

An array of [font weights](https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight). If no value is specified in your configuration, only weight `400` is included by default to prevent unnecessary downloads. You will need to include this property to access any other font weights:


    weights: [200, "400", "bold"]

If the associated font is a [variable font](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Variable_fonts_guide), you can specify a range of weights:


    weights: ["100 900"]

### font.styles


**Type:** `Array<("normal"|"italic"|"oblique")>`
**Default:** `["normal", "italic"]`


**Added in:** `astro@6.0.0`

An array of [font styles](https://developer.mozilla.org/en-US/docs/Web/CSS/font-style):


    styles: ["normal", "oblique"]

### font.subsets


**Type:** `Array<string>`
**Default:** `["latin"]`


**Added in:** `astro@6.0.0`

Defines a list of [font subsets](https://knaap.dev/posts/font-subsetting/) to preload.


    subsets: ["latin"]

### font.formats


**Type:** `Array<("woff2"|"woff"|"otf"|"ttf"|"eot")>`
**Default:** `["woff2"]`


**Added in:** `astro@6.0.0`

An array of [font formats](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/src#font_formats):


    formats: ["woff2", "woff"]

### font.options


**Type:** `Record<string, any>`


**Added in:** `astro@6.0.0`

An object to pass provider specific options. It is typed automatically based on the font family provider:


    options: {

      experimental: {

        glyphs: ["a"]

      }

    }

### font.display


**Type:** `"auto" | "block" | "swap" | "fallback" | "optional"`
**Default:** `"swap"`


**Added in:** `astro@6.0.0`

Defines [how a font displays](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display) based on when it is downloaded and ready for use:


    display: "block"

### font.unicodeRange


**Type:** `Array<string>`
**Default:** `undefined`


**Added in:** `astro@6.0.0`

Determines when a font must be downloaded and used based on a specific [range of unicode characters](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range). If a character on the page matches the configured range, the browser will download the font and all characters will be available for use on the page. To configure a subset of characters preloaded for a single font, see the subsets property instead.

This can be useful for localization to avoid unnecessary font downloads when a specific part of your website uses a different alphabet and will be displayed with a separate font. For example, a website that offers both English and Japanese versions can prevent the browser from downloading the Japanese font on English versions of the page that do not contain any of the Japanese characters provided in `unicodeRange`.


    unicodeRange: ["U+26"]

### font.stretch


**Type:** `string`
**Default:** `undefined`


**Added in:** `astro@6.0.0`

A [font stretch](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-stretch):


    stretch: "condensed"

### font.featureSettings


**Type:** `string`
**Default:** `undefined`


**Added in:** `astro@6.0.0`

Controls the [typographic font features](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-feature-settings) (e.g. ligatures, small caps, or swashes):


    featureSettings: "'smcp' 2"

### font.variationSettings


**Type:** `string`
**Default:** `undefined`


**Added in:** `astro@6.0.0`

Font [variation settings](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-variation-settings):


    variationSettings: "'xhgt' 0.7"

## cache


**Type:** `object`
**Default:** `undefined`


**Added in:** `astro@7.0.0`

Enables route caching for SSR responses. Provides a platform-agnostic API for caching rendered pages and API responses, with pluggable providers that adapters can configure automatically.

astro.config.mjs


    import { defineConfig, memoryCache } from 'astro/config';


    export default defineConfig({

      cache: {

        provider: memoryCache(),

      },

      routeRules: {

        '/blog/[...path]': { maxAge: 300, swr: 60 },

      },

    });

Use `Astro.cache.set()` in routes and `context.cache.set()` in middleware or API routes to control caching per-request.

### cache.provider


**Type:** `CacheProviderConfig`


**Added in:** `astro@7.0.0`

A provider that controls how responses are cached.

Use the provider’s config function to get type-safe configuration:

astro.config.mjs


    import { defineConfig, memoryCache } from 'astro/config';


    export default defineConfig({

      cache: { provider: memoryCache() },

    });

## routeRules


**Type:** `Record<string, RouteRule>`
**Default:** `undefined`


**Added in:** `astro@7.0.0`

Route patterns mapped to cache rules. Uses the same `[param]` and `[...rest]` syntax as [file-based routing](/en/guides/routing/#route-priority-order). Use a `[...rest]` parameter to match a group of routes:

astro.config.mjs


    import { defineConfig, memoryCache } from 'astro/config';


    export default defineConfig({

      cache: { provider: memoryCache() },

      routeRules: {

        '/api/[...path]': { swr: 600 },

        '/products/[...slug]': { maxAge: 3600, tags: ['products'] },

      },

    });
