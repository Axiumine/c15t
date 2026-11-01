<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Adding a website

1. **Dashboard, Admin, Sites, New.** Enter a name, a `siteKey` (e.g. `shop`, which cannot be changed later), the domains (`shop.example.com`, `www.shop.example.com`) and a policy preset. Enter each domain as a bare host name, without a port (see [D1](./decisions.md#d1-websites-reach-consent-api-over-a-private-path-and-there-is-no-public-consent-hostname)).
2. **Add two lines to that website's nginx vhost.** The dashboard shows them. Then run `sudo nginx -t && sudo systemctl reload nginx`.

   ```nginx
   server {
       server_name shop.example.com www.shop.example.com;
       set $c15t_site shop;
       include snippets/c15t.conf;
       # ...existing site config
   }
   ```

3. **Set up the Cloudflare zone** (see [D7](./decisions.md#d7-hosting-cloudflare-then-nginx-then-systemd-no-docker)). Add the Cache Rule that bypasses `/api/c15t/*`. Make sure no WAF or bot rule challenges that path. If Rocket Loader is on, exclude the banner script.
4. **Point the website's banner at the same origin.**
   - Framework packages (`@c15t/react`, `@c15t/nextjs`, ...): set `backendURL: '/api/c15t'`.
   - No framework (WordPress, static HTML): `<script src="/api/c15t/c15t.js" data-cfasync="false" data-categories="measurement,marketing"></script>`. The Setup screen of the website shows this tag and tells the operator to list the categories the site really uses.
   - **Declare the categories your site uses.** Use a comma-separated list of c15t's category names: `functionality`, `experience`, `measurement`, `marketing` (`necessary` is always included). The tag above lists `measurement,marketing` only as a starting point, because sites do not store categories: change `data-categories` to match your page. c15t 3.1.0 infers the categories from the page itself (its gated scripts and this attribute), so a page that declares none records only `necessary`: "Accept All" is stored, but the opt-in rate per purpose stays empty in the dashboard. A framework package needs the same categories declared in its own configuration.
   - Server-side code: `createC15tClient({ baseUrl: `${CONSENT_API_URL}/s/shop`, apiKey })`.
5. **Check it.** `curl -sI https://shop.example.com/api/c15t/status` should return 200 with `cf-cache-status: BYPASS` or `DYNAMIC`.
6. **Assign users** to the website in Admin, Users.
