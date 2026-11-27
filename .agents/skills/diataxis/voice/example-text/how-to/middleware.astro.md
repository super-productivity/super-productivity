---
type: how-to
source: https://docs.astro.build/en/guides/middleware/
title: Middleware
domain: astro
---

**Middleware** allows you to intercept requests and responses and inject behaviors dynamically every time a page or endpoint is about to be rendered. This rendering occurs at build time for all prerendered pages, but occurs when the route is requested for pages rendered on demand, making [additional SSR features like cookies and headers](/en/guides/on-demand-rendering/#on-demand-rendering-features) available.

Middleware also allows you to set and share request-specific information across endpoints and pages by mutating a `locals` object that is available in all Astro components and API endpoints. This object is available even when this middleware runs at build time.

## Basic Usage


  1. Create `src/middleware.js|ts` (Alternatively, you can create `src/middleware/index.js|ts`.)

  2. Inside this file, export an [`onRequest()`](/en/reference/modules/astro-middleware/#onrequest) function that can be passed a `context` object and `next()` function. This must not be a default export.

src/middleware.js

         export function onRequest (context, next) {

             // intercept data from a request

             // optionally, modify the properties in `locals`

             context.locals.title = "New title";

             context.locals.property = "information";


             // return a Response or the result of calling `next()`

             return next();

         };

  3. Inside any `.astro` file, access response data using `Astro.locals`.

src/components/Component.astro

         ---

         const data = Astro.locals;

         ---

         <h1>{data.title}</h1>

         <p>This {data.property} is from middleware.</p>


### The `context` object


The [`context`](/en/reference/api-reference/) object includes information to be made available to other middleware, API routes and `.astro` routes during the rendering process.

This is an optional argument passed to `onRequest()` that may contain the `locals` object as well as any additional properties to be shared during rendering. For example, the `context` object may include cookies used in authentication.

### Storing data in `context.locals`


`context.locals` is an object that can be manipulated inside the middleware.

This `locals` object is forwarded across the request handling process and is available as a property to [`APIContext`](/en/reference/api-reference/#locals) and [`AstroGlobal`](/en/reference/api-reference/#locals). This allows data to be shared between middlewares, API routes, and `.astro` pages. This is useful for storing request-specific data, such as user data, across the rendering step.

You can store any type of data inside `locals`: strings, numbers, and even complex data types such as functions and maps.

src/middleware.js


    export function onRequest (context, next) {

        // intercept data from a request

        // optionally, modify the properties in `locals`

        context.locals.user = { id: 1, name: "John Wick" };

        context.locals.welcomeTitle = () => {

            return "Welcome back " + context.locals.user.name;

        };

        context.locals.orders = new Map([["1", { product: "socks" }]]);

        context.locals.property = "information";


        // return a Response or the result of calling `next()`

        return next();

    };

Then you can use this information inside any `.astro` file with `Astro.locals`.

src/pages/orders.astro


    ---

    const title = Astro.locals.welcomeTitle();

    const orders = Array.from(Astro.locals.orders.entries());

    const data = Astro.locals;

    ---

    <h1>{title}</h1>

    <p>This {data.property} is from middleware.</p>

    <ul>

        {orders.map(order => {

            return <li>{/* do something with each order */}</li>;

        })}

    </ul>

`locals` is an object that lives and dies within a single Astro route; when your route page is rendered, `locals` won’t exist anymore and a new one will be created. Information that needs to persist across multiple page requests must be stored elsewhere.

## Example: redacting sensitive information


The example below uses middleware to replace “PRIVATE INFO” with the word “REDACTED” to allow you to render modified HTML on your page:

src/middleware.js


    export const onRequest = async (context, next) => {

        const response = await next();

        const html = await response.text();

        const redactedHtml = html.replaceAll("PRIVATE INFO", "REDACTED");


        return new Response(redactedHtml, {

            status: 200,

            headers: response.headers

        });

    };

## Middleware types


You can import and use the utility function [`defineMiddleware()`](/en/reference/modules/astro-middleware/#definemiddleware) to take advantage of type safety:

src/middleware.ts


    import { defineMiddleware } from "astro:middleware";


    // `context` and `next` are automatically typed

    export const onRequest = defineMiddleware((context, next) => {


    });

Instead, if you’re using JsDoc to take advantage of type safety, you can use `MiddlewareHandler`:

src/middleware.js


    /**

     * @type {import("astro").MiddlewareHandler}

     */

    // `context` and `next` are automatically typed

    export const onRequest = (context, next) => {


    };

To type the information inside `Astro.locals`, which gives you autocompletion inside `.astro` files and middleware code, [extend the global types](/en/guides/typescript/#extending-global-types) by declaring a global namespace in the `env.d.ts` file:

src/env.d.ts


    type User = {

      id: number;

      name: string;

    };


    declare namespace App {

      interface Locals {

        user: User;

        welcomeTitle: () => string;

        orders: Map<string, object>;

        session: import("./lib/server/session").Session | null;

      }

    }

Then, inside the middleware file, you can take advantage of autocompletion and type safety.

## Chaining middleware


Multiple middlewares can be joined in a specified order using [`sequence()`](/en/reference/modules/astro-middleware/#sequence):

src/middleware.js


    import { sequence } from "astro:middleware";


    async function validation(_, next) {

        console.log("validation request");

        const response = await next();

        console.log("validation response");

        return response;

    }


    async function auth(_, next) {

        console.log("auth request");

        const response = await next();

        console.log("auth response");

        return response;

    }


    async function greeting(_, next) {

        console.log("greeting request");

        const response = await next();

        console.log("greeting response");

        return response;

    }


    export const onRequest = sequence(validation, auth, greeting);

This will result in the following console order:

Terminal window


    validation request

    auth request

    greeting request

    greeting response

    auth response

    validation response

## Rewriting


**Added in:** `astro@4.13.0`

The `APIContext` exposes a method called [`rewrite()`](/en/reference/api-reference/#rewrite) which works the same way as [Astro.rewrite](/en/guides/routing/#rewrites).

Use `context.rewrite()` inside middleware to display a different page’s content without [redirecting](/en/guides/routing/#dynamic-redirects) your visitor to a new page. This will trigger a new rendering phase, causing any middleware to be re-executed.

src/middleware.js


    import { isLoggedIn } from "~/auth.js"

    export function onRequest (context, next) {

      if (!isLoggedIn(context)) {

        // If the user is not logged in, update the Request to render the `/login` route and

        // add header to indicate where the user should be sent after a successful login.

        // Re-execute middleware.

        return context.rewrite(new Request("/login", {

          headers: {

            "x-redirect-to": context.url.pathname

          }

        }));

      }


      return next();

    };

You can also pass the `next()` function an optional URL path parameter to rewrite the current `Request` without retriggering a new rendering phase. The location of the rewrite path can be provided as a string, URL, or `Request`:

src/middleware.js


    import { isLoggedIn } from "~/auth.js"

    export function onRequest (context, next) {

      if (!isLoggedIn(context)) {

        // If the user is not logged in, update the Request to render the `/login` route and

        // add header to indicate where the user should be sent after a successful login.

        // Return a new `context` to any following middlewares.

        return next(new Request("/login", {

          headers: {

            "x-redirect-to": context.url.pathname

          }

        }));

      }


      return next();

    };

The `next()` function accepts the same payload as [the `Astro.rewrite()` function](/en/reference/api-reference/#rewrite). The location of the rewrite path can be provided as a string, URL, or `Request`.

When you have multiple middleware functions chained via sequence(), submitting a path to `next()` will rewrite the `Request` in place and the middleware will not execute again. The next middleware function in the chain will receive the new `Request` with its updated `context`.

Calling `next()` with this signature will create a new `Request` object using the old `ctx.request`. This means that trying to consume `Request.body`, either before or after this rewrite, will throw a runtime error. This error is often raised with [Astro Actions that use HTML forms](/en/guides/actions/#call-actions-from-an-html-form-action). In these cases, we recommend handling rewrites from your Astro templates using `Astro.rewrite()` instead of using middleware.

src/middleware.js


    import { sequence } from "astro:middleware";


    // Current URL is https://example.com/blog


    // First middleware function

    async function first(context, next) {

      console.log(context.url.pathname) // this will log "/blog"

      // Rewrite to a new route, the homepage

      // Return updated `context` which is passed to next function

      return next("/")

    }


    // Current URL is still https://example.com/blog


    // Second middleware function

    async function second(context, next) {

      // Receives updated `context`

      console.log(context.url.pathname) // this will log  "/"

      return next()

    }


    export const onRequest = sequence(first, second);

## Error pages


Middleware will attempt to run for all on-demand rendered pages, even when a matching route cannot be found. This includes Astro’s default (blank) 404 page and any custom 404 pages. However, it is up to the [adapter](/en/guides/on-demand-rendering/) to decide whether that code runs. Some adapters may serve a platform-specific error page instead.

Middleware will also attempt to run before serving a 500 error page, including a custom 500 page, unless the server error occurred in the execution of the middleware itself. If your middleware does not run successfully, then you will not have access to `Astro.locals` to render your 500 page.
