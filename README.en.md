# emdash-modo-liga

An [EmDash CMS](https://emdashcms.com) plugin that keeps a Cloudflare-hosted site reachable from Spain during LaLiga matches, when Spanish ISPs block shared Cloudflare IP ranges under a court order (ruling 310/2024, in force until ~June 2027).

How it works: a cron inside the Worker reads the match calendar (ESPN, football-data.org or a manual list), optionally checks the live block list at hayahora.futbol, and when a match window is open it flips the site's Cloudflare DNS records from *proxied* to *DNS only* so traffic lands on a Netlify mirror. The mirror serves a static copy made by the bundled crawler and proxies everything else (admin, search, MCP, login) back to the Worker through Netlify signed proxy redirects; the Worker wrapper `withModoLiga` verifies the signature and rewrites the host. A small banner and a `/sin-acceso` page explain what is happening and offer a ready-made post on X mentioning @LaLiga and @Cloudflare.

Full documentation (Spanish): [README.md](./README.md). The problem is specific to Spain, so defaults and texts are in Spanish; every text is configurable from the EmDash admin.
