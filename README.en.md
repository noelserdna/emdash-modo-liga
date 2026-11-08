# emdash-modo-liga

**Your site stays open when there is football.** An [EmDash CMS](https://emdashcms.com) plugin for sites on Cloudflare Workers that, on LaLiga match days, move themselves to an emergency copy on Netlify and come back when the block is over.

**The problem.** Since December 2024 a Barcelona court order (310/2024, in force until the end of the 2026-27 season) lets LaLiga make Spanish ISPs block IP addresses while matches are played. Most of them are shared Cloudflare IPs: OONI counted 554,507 domains and 7,441 IPs wrongly blocked between January and June 2026, 90 % of the domains behind Cloudflare. Blocks start 5-10 minutes before kick-off and last 30-75 minutes after the final whistle. A Worker has no origin to fall back to, so the WordPress-style fix (drop the orange cloud) does not apply.

**The idea.** A cron inside the Worker reads the match calendar (ESPN, football-data.org or a manual list), optionally checks the live block list at hayahora.futbol, and while a match window is open it flips the site's Cloudflare DNS records from *proxied* to *DNS only* so traffic lands on a Netlify mirror. The mirror serves a static copy made by the bundled crawler and proxies everything else (admin, search, MCP, login, new URLs) back to the Worker through Netlify signed proxy redirects; the wrapper `withModoLiga` verifies the signature and rewrites the host. A small banner and a `/sin-acceso` page explain what is happening and offer a ready-made post on X mentioning @LaLiga and @Cloudflare.

**Seen in production.** On 8 November 2026 the first site using it, isabellobato.es, became reachable again from a blocked Spanish connection six minutes after the plugin switched DNS during the 21:00 match, with search and the admin working through the signed proxy.

Full documentation (Spanish): [README.md](./README.md). Illustrated guide for non-technical readers: [noelserdna.github.io/emdash-modo-liga](https://noelserdna.github.io/emdash-modo-liga/). The problem is specific to Spain, so defaults and texts are in Spanish; every text is configurable from the EmDash admin.
